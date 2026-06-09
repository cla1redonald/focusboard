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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio server runs until the client disconnects — keep the process alive.
  await new Promise(() => {});
}
