/**
 * Board command agent — a hand-rolled Anthropic tool-use loop.
 *
 * This is the genuine "agentic workflow against the raw API" pattern: we call
 * `client.messages.create` with a tool set, and OUR code runs the loop —
 * read a `tool_use` block, execute it, feed a `tool_result` back, and call the
 * API again — until Claude stops asking for tools (`stop_reason !== "tool_use"`).
 *
 * Mutations execute IMMEDIATELY (no confirmation gate) by reusing the same
 * in-process executor the confirmation flow uses (executeConfirmedOp), so the
 * caller's Authorization header rides along and ROUTE_SCOPES re-enforces
 * card:write on every individual operation. Reads (`list_cards`) load the board
 * fresh each call, so the model sees the effect of its own mutations.
 *
 * Cost is bounded two ways: MAX_STEPS caps the number of API round-trips, and
 * MAX_TOKENS caps each completion. Both are deliberate — an unbounded tool loop
 * is the classic way to burn credits.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Hono } from "hono";
import type { AuthEnv } from "./auth-middleware.js";
import { executeConfirmedOp } from "./confirm-executor.js";
import { loadBoard, slimCard, tagNameResolver } from "./board.js";
import { filterCards, DEFAULT_FILTER } from "../../src/app/filters.js";
import { getActiveCards } from "../../src/app/today.js";

// Sonnet 4 for reliable multi-step tool use. Swap to a Haiku id to cut cost if
// the instructions in practice stay simple — the loop is model-agnostic.
const MODEL = "claude-sonnet-4-20250514";
const MAX_STEPS = 10; // hard cap on API round-trips (cost + runaway-loop guard)
const MAX_TOKENS = 1024;
const MAX_LIST_ITEMS = 80; // cap board rows fed back per list_cards call (token guard)

/** A minimal structural view of the Hono app — just what the executor needs. */
type AppLike = Pick<Hono<AuthEnv>, "fetch">;

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface AgentResult {
  /** Claude's final natural-language summary of what it did. */
  summary: string;
  /** Every tool call executed, in order, with success/failure. */
  steps: AgentStep[];
  /** True if the loop hit MAX_STEPS before Claude finished. */
  stoppedAtCap: boolean;
}

export interface RunBoardAgentOptions {
  app: AppLike;
  authHeader: string;
  userId: string;
  instruction: string;
  /** Injectable for tests; defaults to a real client from ANTHROPIC_API_KEY. */
  client?: Pick<Anthropic, "messages">;
}

const READ_TOOL = "list_cards";

const TOOLS: Anthropic.Tool[] = [
  {
    name: READ_TOOL,
    description:
      "Inspect the board. Returns matching cards (with their id, column, tags, version), the list of valid columns, and the tag legend (id + name). Call this FIRST to discover real card ids and valid column ids before mutating anything.",
    input_schema: {
      type: "object",
      properties: {
        column: { type: "string", description: "Filter to a single column id." },
        q: { type: "string", description: "Free-text search over card titles/notes." },
        swimlane: { type: "string", enum: ["work", "personal"], description: "Filter by swimlane." },
      },
    },
  },
  {
    name: "add_card",
    description: "Create a new card.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The card title (required)." },
        column: { type: "string", description: "Target column id (defaults to backlog)." },
        swimlane: { type: "string", enum: ["work", "personal"] },
        dueDate: { type: "string", description: "ISO date, e.g. 2026-06-27." },
        tags: { type: "array", items: { type: "string" }, description: "Tag IDs (from the list_cards tag legend)." },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "move_card",
    description: "Move one card to a different column.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card id (from list_cards)." },
        column: { type: "string", description: "Destination column id." },
      },
      required: ["card_id", "column"],
    },
  },
  {
    name: "done_card",
    description: "Mark a card complete (move it to the terminal/done column).",
    input_schema: {
      type: "object",
      properties: { card_id: { type: "string" } },
      required: ["card_id"],
    },
  },
  {
    name: "update_card",
    description: "Edit fields on an existing card. Only include the fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        dueDate: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        blockedReason: { type: "string" },
      },
      required: ["card_id"],
    },
  },
  {
    name: "move_cards",
    description: "Move several cards at once. Prefer this over repeated move_card calls.",
    input_schema: {
      type: "object",
      properties: {
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: {
              card_id: { type: "string" },
              column: { type: "string" },
            },
            required: ["card_id", "column"],
          },
        },
      },
      required: ["moves"],
    },
  },
];

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return [
    "You are FocusBoard's board assistant. You carry out a user's natural-language",
    "instruction by calling the provided tools against their kanban board.",
    "",
    `Today is ${today}. Swimlanes are "work" (default) and "personal".`,
    "",
    "Rules:",
    "- ALWAYS call list_cards first to discover real card ids, valid column ids, and the tag legend. Never invent ids.",
    "- Take the minimum number of actions needed. Use move_cards for multi-card moves.",
    "- If the instruction is ambiguous or no cards match, do nothing and explain why.",
    "- Your actions take effect IMMEDIATELY — there is no undo. Be conservative.",
    "- When finished, reply with a short, plain summary of exactly what you did (or why you did nothing). Do not include tool syntax.",
  ].join("\n");
}

/** Read tool: load the board fresh and project it the way GET /api/cards does. */
async function runListCards(
  userId: string,
  input: { column?: string; q?: string; swimlane?: string }
): Promise<unknown> {
  const board = await loadBoard(userId);
  if (!board) return { total: 0, items: [], columns: [], tags: [], note: "No board found for this user." };

  let cards = filterCards(getActiveCards(board.cards, board.columns), {
    ...DEFAULT_FILTER,
    search: input.q ?? "",
    columns: input.column ? [input.column] : [],
  });
  if (input.swimlane) {
    cards = cards.filter((card) => (card.swimlane ?? "work") === input.swimlane);
  }
  cards.sort((a, b) =>
    a.column === b.column ? (a.order ?? 0) - (b.order ?? 0) : a.column.localeCompare(b.column)
  );

  const resolveTags = tagNameResolver(board.state.tags);
  return {
    total: cards.length,
    items: cards.slice(0, MAX_LIST_ITEMS).map((card) => ({
      ...slimCard(card, resolveTags),
      version: board.versions.get(card.id) ?? null,
    })),
    columns: board.columns
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((col) => ({ id: col.id, title: col.title, isTerminal: col.isTerminal })),
    tags: (board.state.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

/**
 * Execute a single tool call. Reads run locally; mutations go through the
 * shared in-process executor (immediate, scope-enforced).
 */
async function executeTool(
  opts: { app: AppLike; authHeader: string; userId: string },
  name: string,
  input: Record<string, unknown>
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  try {
    if (name === READ_TOOL) {
      const result = await runListCards(opts.userId, input as { column?: string; q?: string; swimlane?: string });
      return { ok: true, result };
    }
    // All other tools are mutations on the confirmation allowlist.
    const result = await executeConfirmedOp(opts.app as Hono<AuthEnv>, name, input, opts.authHeader);
    return { ok: true, result };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { ok: false, result: null, error: `${e.code ?? "ERROR"}: ${e.message ?? "tool failed"}` };
  }
}

export async function runBoardAgent(opts: RunBoardAgentOptions): Promise<AgentResult> {
  const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.instruction }];
  const steps: AgentStep[] = [];
  let summary = "";
  let stoppedAtCap = true;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      tools: TOOLS,
      messages,
    });

    // Record the assistant turn verbatim so the next request has full context.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // Done — collect the final natural-language summary.
      summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      stoppedAtCap = false;
      break;
    }

    // Execute every tool the model asked for this turn, in order.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const outcome = await executeTool(
        { app: opts.app, authHeader: opts.authHeader, userId: opts.userId },
        tu.name,
        input
      );
      if (tu.name !== READ_TOOL) {
        steps.push({ tool: tu.name, args: input, ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}) });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }).slice(0, 4000),
        ...(outcome.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (stoppedAtCap && !summary) {
    summary = "Reached the action limit before finishing. Some steps may be incomplete — re-check the board.";
  }
  return { summary, steps, stoppedAtCap };
}
