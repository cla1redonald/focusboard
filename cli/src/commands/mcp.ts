import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FocusboardClient, ApiError } from "../client.js";
import { saveAliases } from "../aliases.js";

/**
 * The Focusboard MCP server (local stdio) — Tier 1 capture-safe tools only.
 *
 * Naming convention (from the design review): read tools are focusboard_<noun>,
 * write tools are focusboard_<verb>_<noun> — the read/write split is visible in
 * the name. All tools go through the same FocusboardClient as the CLI; the agent
 * never touches Supabase. Tier 2 (read-board) arrives with Phase 2, Tier 3
 * (board mutation + confirmation gate) with Phase 4.
 *
 * Run: `fb mcp` — e.g. `claude mcp add focusboard -- fb mcp`.
 * Auth: FOCUSBOARD_TOKEN env var, or the CLI credentials file (`fb auth login`).
 */

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

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

export async function mcpCommand() {
  const client = new FocusboardClient();
  const server = new McpServer({ name: "focusboard", version: "0.1.0" });

  server.registerTool(
    "focusboard_capture",
    {
      title: "Capture to Focusboard",
      description:
        "Capture a raw thought, task, or note into the Focusboard inbox. Append-only and safe: " +
        "nothing is added to the board automatically — Claire triages captures in the Capture Inbox. " +
        "Use one call per distinct item.",
      inputSchema: {
        content: z.string().min(1).max(10000).describe("The raw text to capture"),
      },
    },
    async ({ content }) => {
      try {
        const result = await client.capture(content, { source: "in_app" });
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_inbox",
    {
      title: "List the Focusboard capture inbox",
      description:
        "List pending captures in the Focusboard inbox (snoozed items are hidden until due). " +
        "Returns each capture's id, raw content, AI-parsed title (if processed), source, and timestamps. " +
        "Use the id with focusboard_snooze_capture.",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.inbox();
        saveAliases(result.items.map((i) => i.id)); // keep CLI aliases in sync
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_snooze_capture",
    {
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
    },
    async ({ capture_id, minutes }) => {
      try {
        const result = await client.snooze(capture_id, minutes);
        return okResult(result);
      } catch (err) {
        return errResult(err);
      }
    }
  );

  // ── Tier 2 — read-only board ─────────────────────────────────────────────────

  server.registerTool(
    "focusboard_today",
    {
      title: "Focusboard Today plan",
      description:
        "Read today's plan: the daily plan (main + support cards), rule-ranked focus " +
        "recommendations with reasons, attention lists (overdue, due today, blocked, stale), " +
        "and WIP pressure. Read-only. Use this to answer 'what should Claire focus on?'",
      inputSchema: {},
    },
    async () => {
      try {
        return okResult(await client.today());
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_cards",
    {
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
    },
    async (args) => {
      try {
        return okResult(await client.cards(args));
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_wip",
    {
      title: "Focusboard WIP status",
      description:
        "Read work-in-progress per column versus its WIP limit (atLimit flags columns at or " +
        "over their limit). Read-only. Use before suggesting Claire start something new.",
      inputSchema: {},
    },
    async () => {
      try {
        return okResult(await client.wip());
      } catch (err) {
        return errResult(err);
      }
    }
  );

  // ── Tier 2 — Phase 5a workflow reads + batch capture ────────────────────────

  server.registerTool(
    "focusboard_focus_history",
    {
      title: "Focus session history",
      description:
        "Closed focus sessions over a window (default 7 days, max 90) with aggregates: total " +
        "minutes, counts by outcome, minutes per day. Read-only. Use for 'summarise my focus week'.",
      inputSchema: {
        days: z.number().int().min(1).max(90).default(7).describe("Window in days"),
      },
    },
    async ({ days }) => {
      try {
        return okResult(await client.focusHistory(days));
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_shutdown",
    {
      title: "Daily shutdown digest",
      description:
        "The daily shutdown ritual as data — today's completions, focus aggregates, slipped/" +
        "blocked/stale cards, and tomorrow candidates (each card carries the version needed for " +
        "a follow-up mutation). Same semantics as the web's Shutdown panel. Read-only. Use for " +
        "'prepare my daily shutdown' and narrate the result conversationally.",
      inputSchema: {},
    },
    async () => {
      try {
        return okResult(await client.reviewDaily());
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_week",
    {
      title: "Weekly review digest",
      description:
        "The weekly review as data — this week's completions, focus aggregates, blocked cards, " +
        "stale backlog, and proposed commitments for next week. Same semantics as the web's " +
        "Weekly Review panel. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        return okResult(await client.reviewWeekly());
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_capture_actions",
    {
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
    },
    async ({ items }) => {
      try {
        return okResult(await client.captureBatch(items));
      } catch (err) {
        return errResult(err);
      }
    }
  );

  // ── Tier 3 — focus sessions (mutation, but append-only rows) ────────────────
  //
  // Decision (2026-06-09): NO confirmation-token gate for focus start/stop —
  // they are low-risk, self-reversing operations on an append-only table, and a
  // confirm round-trip would wreck agent UX for a benign action. The gate
  // arrives with Phase 4 card mutation, where the operations destroy state.

  server.registerTool(
    "focusboard_start_focus_session",
    {
      title: "Start a focus session",
      description:
        "Start a focus session, optionally tied to a board card (id from focusboard_cards). " +
        "Only one session can be active; if one is already running this returns ALREADY_ACTIVE " +
        "with a hint. Append-only and self-reversing (stop it with focusboard_stop_focus_session).",
      inputSchema: {
        card_id: z.string().optional().describe("Board card id to focus on (from focusboard_cards)"),
        planned_minutes: z.number().int().min(1).max(480).default(25).describe("Planned length in minutes"),
      },
    },
    async ({ card_id, planned_minutes }) => {
      try {
        return okResult(await client.focusStart({ cardId: card_id, plannedMinutes: planned_minutes }));
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_stop_focus_session",
    {
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
    },
    async ({ outcome, note }) => {
      try {
        return okResult(await client.focusStop({ outcome, note }));
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_focus_status",
    {
      title: "Focus session status",
      description:
        "Read the active focus session (if any) plus today's session count and focused minutes. " +
        "Read-only. Check this before suggesting Claire start something new.",
      inputSchema: {},
    },
    async () => {
      try {
        return okResult(await client.focusStatus());
      } catch (err) {
        return errResult(err);
      }
    }
  );

  // ── Tier 3 — card mutation, behind the confirmation gate ────────────────────
  //
  // Card mutations change board state an agent could get wrong. Every mutation
  // tool returns { status: "confirmation_required", confirm_token, preview }
  // instead of executing; the agent must echo the token to focusboard_confirm.
  // Silent agent mutation is therefore impossible — the confirm call is a
  // deliberate, visible second step. Tokens are single-use and expire in 5 min.
  // The mutation itself does a FRESH read-then-CAS at confirm time, so even a
  // confirmed op cannot clobber a card that changed since the proposal (409
  // STALE_STATE comes back with a hint instead).

  const CONFIRM_TTL_MS = 5 * 60 * 1000;
  const pendingOps = new Map<string, { preview: string; execute: () => Promise<unknown>; expiresAt: number }>();

  function propose(preview: string, execute: () => Promise<unknown>): ToolResult {
    for (const [token, op] of pendingOps) {
      if (op.expiresAt < Date.now()) pendingOps.delete(token);
    }
    const confirmToken = randomUUID();
    pendingOps.set(confirmToken, { preview, execute, expiresAt: Date.now() + CONFIRM_TTL_MS });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: {
            status: "confirmation_required",
            confirm_token: confirmToken,
            expires_in_seconds: CONFIRM_TTL_MS / 1000,
            preview,
            hint: "Call focusboard_confirm with this confirm_token to execute",
          },
        }),
      }],
    };
  }

  async function freshVersion(cardId: string): Promise<{ version: number | null; title: string }> {
    const { card } = await client.cardGet(cardId);
    return { version: card.version, title: card.title };
  }

  server.registerTool(
    "focusboard_add_card",
    {
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
    },
    async (args) => {
      const where = `${args.column ?? "backlog"} (${args.swimlane ?? "work"})`;
      return propose(`Add card "${args.title}" to ${where}`, () =>
        client.cardAdd({
          title: args.title,
          column: args.column,
          swimlane: args.swimlane,
          dueDate: args.due_date,
          tags: args.tags,
          notes: args.notes,
        })
      );
    }
  );

  server.registerTool(
    "focusboard_move_card",
    {
      title: "Move a card (requires confirmation)",
      description:
        "Propose moving a card to another column. Returns a confirm_token; executes only after " +
        "focusboard_confirm. The move re-reads the card at confirm time (409 STALE_STATE if it changed).",
      inputSchema: {
        card_id: z.string().describe("Card id (from focusboard_cards)"),
        column: z.string().describe("Target column id"),
      },
    },
    async ({ card_id, column }) => {
      try {
        const { version, title } = await freshVersion(card_id);
        void version;
        return propose(`Move "${title}" → ${column}`, async () => {
          const fresh = await freshVersion(card_id);
          return client.cardMove(card_id, fresh.version, column);
        });
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_complete_card",
    {
      title: "Complete a card (requires confirmation)",
      description:
        "Propose completing a card (moves it to the done column). Returns a confirm_token; " +
        "executes only after focusboard_confirm.",
      inputSchema: {
        card_id: z.string().describe("Card id (from focusboard_cards)"),
      },
    },
    async ({ card_id }) => {
      try {
        const { title } = await freshVersion(card_id);
        return propose(`Complete "${title}"`, async () => {
          const fresh = await freshVersion(card_id);
          return client.cardDone(card_id, fresh.version);
        });
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_update_card",
    {
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
    },
    async ({ card_id, title, notes, due_date, tags, blocked_reason }) => {
      try {
        const current = await freshVersion(card_id);
        const fields = Object.entries({ title, notes, dueDate: due_date, tags, blockedReason: blocked_reason })
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k)
          .join(", ");
        return propose(`Update "${current.title}" (${fields})`, async () => {
          const fresh = await freshVersion(card_id);
          return client.cardPatch(card_id, fresh.version, {
            ...(title !== undefined ? { title } : {}),
            ...(notes !== undefined ? { notes } : {}),
            ...(due_date !== undefined ? { dueDate: due_date } : {}),
            ...(tags !== undefined ? { tags } : {}),
            ...(blocked_reason !== undefined ? { blockedReason: blocked_reason } : {}),
          });
        });
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_move_cards",
    {
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
    },
    async ({ moves }) => {
      try {
        // Validate NOW so the agent sees a trustworthy plan: every card must
        // resolve to a title (404s surface here, before any token is minted).
        const lines: string[] = [];
        for (const m of moves) {
          const { title } = await freshVersion(m.card_id);
          lines.push(`Move "${title}" → ${m.column}`);
        }
        const preview = `${moves.length} move${moves.length === 1 ? "" : "s"}:\n` + lines.join("\n");
        return propose(preview, () =>
          client.cardBatchMove(moves.map((m) => ({ id: m.card_id, to: m.column })))
        );
      } catch (err) {
        return errResult(err);
      }
    }
  );

  server.registerTool(
    "focusboard_confirm",
    {
      title: "Execute a proposed mutation",
      description:
        "Execute a mutation previously proposed by focusboard_add_card / move_card / " +
        "complete_card / update_card / move_cards, using its confirm_token. Tokens are " +
        "single-use and expire after 5 minutes.",
      inputSchema: {
        confirm_token: z.string().describe("The confirm_token from the proposal"),
      },
    },
    async ({ confirm_token }) => {
      const op = pendingOps.get(confirm_token);
      if (!op || op.expiresAt < Date.now()) {
        pendingOps.delete(confirm_token);
        return errResult(
          new ApiError(410, {
            code: "CONFIRMATION_EXPIRED",
            message: "Unknown or expired confirm_token",
            hint: "Propose the mutation again to get a fresh token",
          })
        );
      }
      pendingOps.delete(confirm_token); // single-use, even on failure
      try {
        return okResult({ executed: op.preview, result: await op.execute() });
      } catch (err) {
        return errResult(err);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio server runs until the client disconnects — keep the process alive.
  await new Promise(() => {});
}
