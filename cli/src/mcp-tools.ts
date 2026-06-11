/**
 * Shared MCP tool registry — all Focusboard MCP tool definitions in one place.
 *
 * Each entry carries:
 *   name         — the tool name registered with McpServer
 *   title        — human-readable display name
 *   description  — shown to the agent
 *   inputSchema  — Zod raw shape (as passed to McpServer.registerTool)
 *   tier         — 1 (append-only safe), 2 (read-only board), 3 (mutation with gate)
 *   handler      — async (client, args) → ToolResult
 *
 * Tier-3 handlers call client.confirmationCreate() and return a
 * confirmation_required payload. focusboard_confirm calls client.confirmationExecute().
 * The in-process pendingOps Map is gone — the server owns the token lifecycle.
 *
 * Note: handlers receive args typed as Record<string, unknown> and cast the
 * fields they need. The MCP SDK validates inputs against the inputSchema before
 * calling the handler, so the casts are safe.
 */

import { z } from "zod";
import { FocusboardClient, ApiError, type ConfirmationPayload } from "./client.js";
import { saveAliases } from "./aliases.js";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

// The handler receives the schema-validated args from McpServer (typed as unknown
// at the registry level; each handler casts to the specific shape it needs).
export type ToolDef = {
  name: string;
  title: string;
  description: string;
   
  inputSchema: Record<string, z.ZodTypeAny>;
  tier: 1 | 2 | 3;
  handler: (client: FocusboardClient, args: Record<string, unknown>) => Promise<ToolResult>;
};

// ── Result helpers ─────────────────────────────────────────────────────────────

function okResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] };
}

function errResult(err: unknown): ToolResult {
  const error =
    err instanceof ApiError
      ? { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
      : { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
    isError: true,
  };
}

function confirmResult(payload: ConfirmationPayload): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, data: payload }) }],
  };
}

// ── Shared utility ─────────────────────────────────────────────────────────────

async function freshTitle(client: FocusboardClient, cardId: string): Promise<string> {
  const { card } = await client.cardGet(cardId);
  return card.title;
}

// ── Tool registry ──────────────────────────────────────────────────────────────

export const MCP_TOOLS: ToolDef[] = [

  // ── Tier 1 — append-only, capture-safe ──────────────────────────────────────

  {
    name: "focusboard_capture",
    title: "Capture to Focusboard",
    description:
      "Capture a raw thought, task, or note into the Focusboard inbox. Append-only and safe: " +
      "nothing is added to the board automatically — Claire triages captures in the Capture Inbox. " +
      "Use one call per distinct item.",
    inputSchema: {
      content: z.string().min(1).max(10000).describe("The raw text to capture"),
    },
    tier: 1,
    async handler(client, args) {
      try {
        const content = args.content as string;
        return okResult(await client.capture(content, { source: "in_app" }));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_inbox",
    title: "List the Focusboard capture inbox",
    description:
      "List pending captures in the Focusboard inbox (snoozed items are hidden until due). " +
      "Returns each capture's id, raw content, AI-parsed title (if processed), source, and timestamps. " +
      "Use the id with focusboard_snooze_capture.",
    inputSchema: {},
    tier: 1,
    async handler(client) {
      try {
        const result = await client.inbox();
        saveAliases(result.items.map((i) => i.id));
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_snooze_capture",
    title: "Snooze a Focusboard capture",
    description:
      "Hide a capture from the inbox until a later time (it returns automatically when due). " +
      "Get capture ids from focusboard_inbox first.",
    inputSchema: {
      capture_id: z.string().uuid().describe("The capture id (a UUID, from focusboard_inbox)"),
      minutes: z
        .number()
        .int()
        .min(1)
        .max(43200)
        .default(60)
        .describe("How long to snooze, in minutes (max 30 days)"),
    },
    tier: 1,
    async handler(client, args) {
      try {
        const capture_id = args.capture_id as string;
        const minutes = args.minutes as number;
        return okResult(await client.snooze(capture_id, minutes));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  // ── Tier 2 — read-only board ─────────────────────────────────────────────────

  {
    name: "focusboard_today",
    title: "Focusboard Today plan",
    description:
      "Read today's plan: the daily plan (main + support cards), rule-ranked focus " +
      "recommendations with reasons, attention lists (overdue, due today, blocked, stale), " +
      "and WIP pressure. Read-only. Use this to answer 'what should Claire focus on?'",
    inputSchema: {},
    tier: 2,
    async handler(client) {
      try {
        return okResult(await client.today());
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_cards",
    title: "List or search Focusboard cards",
    description:
      "List active board cards, optionally filtered by column id (e.g. doing, backlog, " +
      "blocked), swimlane (work | personal), or a search query matching title, notes, tags, " +
      "and checklist text. Read-only.",
    inputSchema: {
      column: z.string().optional().describe("Filter by column id"),
      swimlane: z.enum(["work", "personal"]).optional().describe("Filter by swimlane"),
      q: z.string().optional().describe("Search query"),
      limit: z.number().int().min(1).max(200).optional().describe("Max cards to return"),
    },
    tier: 2,
    async handler(client, args) {
      try {
        return okResult(await client.cards({
          column: args.column as string | undefined,
          q: args.q as string | undefined,
          swimlane: args.swimlane as "work" | "personal" | undefined,
          limit: args.limit as number | undefined,
        }));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_wip",
    title: "Focusboard WIP status",
    description:
      "Read work-in-progress per column versus its WIP limit (atLimit flags columns at or " +
      "over their limit). Read-only. Use before suggesting Claire start something new.",
    inputSchema: {},
    tier: 2,
    async handler(client) {
      try {
        return okResult(await client.wip());
      } catch (err) {
        return errResult(err);
      }
    },
  },

  // ── Tier 2 — Phase 5a workflow reads + batch capture ────────────────────────

  {
    name: "focusboard_focus_history",
    title: "Focus session history",
    description:
      "Closed focus sessions over a window (default 7 days, max 90) with aggregates: total " +
      "minutes, counts by outcome, minutes per day. Read-only. Use for 'summarise my focus week'.",
    inputSchema: {
      days: z.number().int().min(1).max(90).default(7).describe("Window in days"),
    },
    tier: 2,
    async handler(client, args) {
      try {
        return okResult(await client.focusHistory(args.days as number));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_shutdown",
    title: "Daily shutdown digest",
    description:
      "The daily shutdown ritual as data — today's completions, focus aggregates, slipped/" +
      "blocked/stale cards, and tomorrow candidates (each card carries the version needed for " +
      "a follow-up mutation). Same semantics as the web's Shutdown panel. Read-only. Use for " +
      "'prepare my daily shutdown' and narrate the result conversationally.",
    inputSchema: {},
    tier: 2,
    async handler(client) {
      try {
        return okResult(await client.reviewDaily());
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_week",
    title: "Weekly review digest",
    description:
      "The weekly review as data — this week's completions, focus aggregates, blocked cards, " +
      "stale backlog, and proposed commitments for next week. Same semantics as the web's " +
      "Weekly Review panel. Read-only.",
    inputSchema: {},
    tier: 2,
    async handler(client) {
      try {
        return okResult(await client.reviewWeekly());
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_capture_actions",
    title: "Batch-capture action items",
    description:
      "Capture MULTIPLE items (e.g. actions you extracted from meeting notes) into the " +
      "Focusboard inbox in one call — split the text into discrete items yourself first. " +
      "Append-only and safe: nothing lands on the board until Claire triages it. Max 25 items; " +
      "retries are idempotent; per-item results are returned.",
    inputSchema: {
      items: z.array(z.string().min(1).max(10000)).min(1).max(25)
        .describe("The action items, one string each"),
    },
    tier: 1,
    async handler(client, args) {
      try {
        return okResult(await client.captureBatch(args.items as string[]));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  // ── Tier 3 — focus sessions (mutation, but append-only rows) ────────────────
  //
  // Decision (2026-06-09): NO confirmation-token gate for focus start/stop —
  // they are low-risk, self-reversing operations on an append-only table.

  {
    name: "focusboard_start_focus_session",
    title: "Start a focus session",
    description:
      "Start a focus session, optionally tied to a board card (id from focusboard_cards). " +
      "Only one session can be active; if one is already running this returns ALREADY_ACTIVE " +
      "with a hint. Append-only and self-reversing (stop it with focusboard_stop_focus_session).",
    inputSchema: {
      card_id: z.string().optional().describe("Board card id to focus on (from focusboard_cards)"),
      planned_minutes: z.number().int().min(1).max(480).default(25).describe("Planned length in minutes"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        return okResult(await client.focusStart({
          cardId: args.card_id as string | undefined,
          plannedMinutes: args.planned_minutes as number,
        }));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_stop_focus_session",
    title: "Stop the active focus session",
    description:
      "Stop the active focus session and log its outcome. Returns the actual focused minutes. " +
      "NOT_FOUND if no session is running.",
    inputSchema: {
      outcome: z
        .enum(["progressed", "blocked", "completed", "abandoned"])
        .default("progressed")
        .describe("What happened during the session"),
      note: z.string().max(1000).optional().describe("Optional note about the session"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        return okResult(await client.focusStop({
          outcome: args.outcome as "progressed" | "blocked" | "completed" | "abandoned" | undefined,
          note: args.note as string | undefined,
        }));
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_focus_status",
    title: "Focus session status",
    description:
      "Read the active focus session (if any) plus today's session count and focused minutes. " +
      "Read-only. Check this before suggesting Claire start something new.",
    inputSchema: {},
    tier: 2,
    async handler(client) {
      try {
        return okResult(await client.focusStatus());
      } catch (err) {
        return errResult(err);
      }
    },
  },

  // ── Tier 3 — card mutations (durable confirmation gate) ─────────────────────
  //
  // Each mutation tool proposes via client.confirmationCreate() (which calls
  // POST /api/confirmations on the server). The server stores the token + args
  // durably; the agent must call focusboard_confirm with the token to execute.
  //
  // For single-card ops the handler fetches the current title (for the preview);
  // the version is NOT stored — the executor reads a fresh version at confirm time.
  // For move_cards, titles are fetched client-side (stdio MCP — no alternative).

  {
    name: "focusboard_add_card",
    title: "Add a card to the board (requires confirmation)",
    description:
      "Propose adding a card directly to the board. Returns a confirm_token — the card is " +
      "only created after focusboard_confirm. For raw thoughts/ideas prefer focusboard_capture " +
      "(goes to the inbox for Claire to triage, no confirmation needed).",
    inputSchema: {
      title: z.string().min(1).max(300).describe("Card title"),
      column: z.string().optional().describe("Column id (default backlog; see focusboard_cards)"),
      swimlane: z.enum(["work", "personal"]).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date YYYY-MM-DD"),
      tags: z.array(z.string()).optional().describe("Existing tag NAMES"),
      notes: z.string().max(5000).optional(),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const title = args.title as string;
        const column = args.column as string | undefined;
        const swimlane = args.swimlane as string | undefined;
        const due_date = args.due_date as string | undefined;
        const tags = args.tags as string[] | undefined;
        const notes = args.notes as string | undefined;

        const where = `${column ?? "backlog"} (${swimlane ?? "work"})`;
        const preview = `Add card "${title}" to ${where}`;
        const serverArgs: Record<string, unknown> = {
          title,
          ...(column !== undefined ? { column } : {}),
          ...(swimlane !== undefined ? { swimlane } : {}),
          ...(due_date !== undefined ? { dueDate: due_date } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(notes !== undefined ? { notes } : {}),
        };
        const { confirm_token, expires_in_seconds } = await client.confirmationCreate("add_card", serverArgs, preview);
        return confirmResult({ status: "confirmation_required", confirm_token, expires_in_seconds, preview, hint: "Call focusboard_confirm with this confirm_token to execute" });
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_move_card",
    title: "Move a card (requires confirmation)",
    description:
      "Propose moving a card to another column. Returns a confirm_token; executes only after " +
      "focusboard_confirm. The move re-reads the card at confirm time (409 STALE_STATE if it changed).",
    inputSchema: {
      card_id: z.string().describe("Card id (from focusboard_cards)"),
      column: z.string().describe("Target column id"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const card_id = args.card_id as string;
        const column = args.column as string;
        const title = await freshTitle(client, card_id);
        const preview = `Move "${title}" → ${column}`;
        const { confirm_token, expires_in_seconds } = await client.confirmationCreate("move_card", { card_id, column }, preview);
        return confirmResult({ status: "confirmation_required", confirm_token, expires_in_seconds, preview, hint: "Call focusboard_confirm with this confirm_token to execute" });
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_complete_card",
    title: "Complete a card (requires confirmation)",
    description:
      "Propose completing a card (moves it to the done column). Returns a confirm_token; " +
      "executes only after focusboard_confirm.",
    inputSchema: {
      card_id: z.string().describe("Card id (from focusboard_cards)"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const card_id = args.card_id as string;
        const title = await freshTitle(client, card_id);
        const preview = `Complete "${title}"`;
        const { confirm_token, expires_in_seconds } = await client.confirmationCreate("done_card", { card_id }, preview);
        return confirmResult({ status: "confirmation_required", confirm_token, expires_in_seconds, preview, hint: "Call focusboard_confirm with this confirm_token to execute" });
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_update_card",
    title: "Update a card's fields (requires confirmation)",
    description:
      "Propose editing a card (title, notes, due date, tags, blocked reason). Returns a " +
      "confirm_token; executes only after focusboard_confirm. Pass null to clear a field.",
    inputSchema: {
      card_id: z.string().describe("Card id (from focusboard_cards)"),
      title: z.string().min(1).max(300).optional(),
      notes: z.string().max(5000).nullable().optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      tags: z.array(z.string()).optional().describe("Existing tag NAMES (replaces the set)"),
      blocked_reason: z.string().max(500).nullable().optional(),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const card_id = args.card_id as string;
        const title = args.title as string | undefined;
        const notes = args.notes as string | null | undefined;
        const due_date = args.due_date as string | null | undefined;
        const tags = args.tags as string[] | undefined;
        const blocked_reason = args.blocked_reason as string | null | undefined;

        const current = await freshTitle(client, card_id);
        const fields = Object.entries({ title, notes, dueDate: due_date, tags, blockedReason: blocked_reason })
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k)
          .join(", ");
        const preview = `Update "${current}" (${fields})`;
        const serverArgs: Record<string, unknown> = { card_id };
        if (title !== undefined) serverArgs.title = title;
        if (notes !== undefined) serverArgs.notes = notes;
        if (due_date !== undefined) serverArgs.dueDate = due_date;
        if (tags !== undefined) serverArgs.tags = tags;
        if (blocked_reason !== undefined) serverArgs.blockedReason = blocked_reason;
        const { confirm_token, expires_in_seconds } = await client.confirmationCreate("update_card", serverArgs, preview);
        return confirmResult({ status: "confirmation_required", confirm_token, expires_in_seconds, preview, hint: "Call focusboard_confirm with this confirm_token to execute" });
      } catch (err) {
        return errResult(err);
      }
    },
  },

  {
    name: "focusboard_move_cards",
    title: "Move MULTIPLE cards in one batch (requires ONE confirmation)",
    description:
      "Propose moving up to 20 cards in one plan — e.g. 'move all waiting-on-someone items " +
      "to blocked'. Returns ONE confirm_token covering the whole plan; after " +
      "focusboard_confirm the moves execute as per-card compare-and-swaps with versions read " +
      "FRESH at confirm time. Partial success is reported per card (a STALE_STATE on one card " +
      "does not stop the others) — re-read and re-plan any failures.",
    inputSchema: {
      moves: z.array(z.object({
        card_id: z.string().describe("Card id (from focusboard_cards)"),
        column: z.string().describe("Target column id"),
      })).min(1).max(20).describe("The moves, one entry per card"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const moves = args.moves as { card_id: string; column: string }[];
        // Validate and build preview titles (404s surface here before minting a token).
        const lines: string[] = [];
        for (const m of moves) {
          const title = await freshTitle(client, m.card_id);
          lines.push(`Move "${title}" → ${m.column}`);
        }
        const preview = `${moves.length} move${moves.length === 1 ? "" : "s"}:\n` + lines.join("\n");
        const { confirm_token, expires_in_seconds } = await client.confirmationCreate(
          "move_cards",
          { moves },
          preview
        );
        return confirmResult({ status: "confirmation_required", confirm_token, expires_in_seconds, preview, hint: "Call focusboard_confirm with this confirm_token to execute" });
      } catch (err) {
        return errResult(err);
      }
    },
  },

  // ── focusboard_confirm ───────────────────────────────────────────────────────
  //
  // Tier-3 execution. Calls POST /api/confirmations/confirm; the server claims
  // the token atomically and dispatches the operation in-process.

  {
    name: "focusboard_confirm",
    title: "Execute a proposed mutation",
    description:
      "Execute a mutation previously proposed by focusboard_add_card / move_card / " +
      "complete_card / update_card / move_cards, using its confirm_token. Tokens are " +
      "single-use, expire after 5 minutes, and are bound to the proposing user — another " +
      "session cannot steal or replay them.",
    inputSchema: {
      confirm_token: z.string().describe("The confirm_token from the proposal"),
    },
    tier: 3,
    async handler(client, args) {
      try {
        const confirm_token = args.confirm_token as string;
        const result = await client.confirmationExecute(confirm_token);
        return okResult({ executed: true, result });
      } catch (err) {
        return errResult(err);
      }
    },
  },
];
