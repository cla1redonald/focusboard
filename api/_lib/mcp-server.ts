/**
 * Hosted MCP server — stateless JSON-RPC handler for POST /api/mcp.
 *
 * Evidence from the Phase 6.0 probe: the claude.ai connector re-initializes
 * on every interaction (stateless is fine), tolerates 405 on GET, needs NO
 * SSE — buffered JSON responses work. The probe shape (initialize/ping/
 * notifications/tools/list/tools/call) is the PROVEN wire format.
 *
 * Tool surface mirrors cli/src/mcp-tools.ts EXACTLY (names, descriptions,
 * input shapes). Handlers dispatch in-process via the composed `server` export
 * (which includes the well-known router + the app). Input validation uses
 * inline JSON Schema objects (no zod — zod is a cli-only dep).
 *
 * OAuth endpoints are envelope-EXEMPT: they return RFC-shaped bodies, not
 * { ok, data } / { ok, error }. This file is also envelope-exempt for the
 * JSON-RPC wrapper (plain { jsonrpc, id, result } / { jsonrpc, id, error }).
 */

import { randomBytes } from "crypto";
import type { Context } from "hono";
import type { AuthEnv } from "./auth-middleware.js";
import type { Principal } from "./auth-middleware.js";

// ── Tool table ─────────────────────────────────────────────────────────────────
// Each entry mirrors the CLI registry's name/description/inputSchema tier
// but uses inline JSON Schema (not Zod).

type JSONSchemaProperty = {
  type: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
};

type InputSchema = {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
};

type HostedToolDef = {
  name: string;
  description: string;
  inputSchema: InputSchema;
  tier: 1 | 2 | 3;
  /** Minimum scope needed to call this tool (enforced via dispatch — not pre-checked here). */
  requiredScope: string;
};

export const HOSTED_TOOLS: HostedToolDef[] = [
  // ── Tier 1 — append-only, capture-safe ──────────────────────────────────────

  {
    name: "focusboard_capture",
    description:
      "Capture a raw thought, task, or note into the Focusboard inbox. Append-only and safe: " +
      "nothing is added to the board automatically — Claire triages captures in the Capture Inbox. " +
      "Use one call per distinct item.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, maxLength: 10000, description: "The raw text to capture" },
      },
      required: ["content"],
    },
    tier: 1,
    requiredScope: "capture:write",
  },

  {
    name: "focusboard_capture_actions",
    description:
      "Capture MULTIPLE items (e.g. actions you extracted from meeting notes) into the " +
      "Focusboard inbox in one call — split the text into discrete items yourself first. " +
      "Append-only and safe: nothing lands on the board until Claire triages it. Max 25 items; " +
      "retries are idempotent; per-item results are returned.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 10000 },
          minItems: 1,
          maxItems: 25,
          description: "The action items, one string each",
        },
      },
      required: ["items"],
    },
    tier: 1,
    requiredScope: "capture:write",
  },

  {
    name: "focusboard_inbox",
    description:
      "List pending captures in the Focusboard inbox (snoozed items are hidden until due). " +
      "Returns each capture's id, raw content, AI-parsed title (if processed), source, and timestamps. " +
      "Use the id with focusboard_snooze_capture.",
    inputSchema: { type: "object", properties: {} },
    tier: 1,
    requiredScope: "capture:read",
  },

  {
    name: "focusboard_snooze_capture",
    description:
      "Hide a capture from the inbox until a later time (it returns automatically when due). " +
      "Get capture ids from focusboard_inbox first.",
    inputSchema: {
      type: "object",
      properties: {
        capture_id: { type: "string", description: "The capture id (a UUID, from focusboard_inbox)" },
        minutes: {
          type: "number",
          minimum: 1,
          maximum: 43200,
          default: 60,
          description: "How long to snooze, in minutes (max 30 days)",
        },
      },
      required: ["capture_id"],
    },
    tier: 1,
    requiredScope: "capture:write",
  },

  // ── Tier 2 — read-only board ─────────────────────────────────────────────────

  {
    name: "focusboard_today",
    description:
      "Read today's plan: the daily plan (main + support cards), rule-ranked focus " +
      "recommendations with reasons, attention lists (overdue, due today, blocked, stale), " +
      "and WIP pressure. Read-only. Use this to answer 'what should Claire focus on?'",
    inputSchema: { type: "object", properties: {} },
    tier: 2,
    requiredScope: "board:read",
  },

  {
    name: "focusboard_cards",
    description:
      "List active board cards, optionally filtered by column id (e.g. doing, backlog, " +
      "blocked), swimlane (work | personal), or a search query matching title, notes, tags, " +
      "and checklist text. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        column: { type: "string", description: "Filter by column id" },
        swimlane: { type: "string", enum: ["work", "personal"], description: "Filter by swimlane" },
        q: { type: "string", description: "Search query" },
        limit: { type: "number", minimum: 1, maximum: 200, description: "Max cards to return" },
      },
    },
    tier: 2,
    requiredScope: "board:read",
  },

  {
    name: "focusboard_wip",
    description:
      "Read work-in-progress per column versus its WIP limit (atLimit flags columns at or " +
      "over their limit). Read-only. Use before suggesting Claire start something new.",
    inputSchema: { type: "object", properties: {} },
    tier: 2,
    requiredScope: "board:read",
  },

  {
    name: "focusboard_focus_history",
    description:
      "Closed focus sessions over a window (default 7 days, max 90) with aggregates: total " +
      "minutes, counts by outcome, minutes per day. Read-only. Use for 'summarise my focus week'.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          minimum: 1,
          maximum: 90,
          default: 7,
          description: "Window in days",
        },
      },
    },
    tier: 2,
    requiredScope: "focus:read",
  },

  {
    name: "focusboard_shutdown",
    description:
      "The daily shutdown ritual as data — today's completions, focus aggregates, slipped/" +
      "blocked/stale cards, and tomorrow candidates (each card carries the version needed for " +
      "a follow-up mutation). Same semantics as the web's Shutdown panel. Read-only. Use for " +
      "'prepare my daily shutdown' and narrate the result conversationally.",
    inputSchema: { type: "object", properties: {} },
    tier: 2,
    requiredScope: "board:read",
  },

  {
    name: "focusboard_week",
    description:
      "The weekly review as data — this week's completions, focus aggregates, blocked cards, " +
      "stale backlog, and proposed commitments for next week. Same semantics as the web's " +
      "Weekly Review panel. Read-only.",
    inputSchema: { type: "object", properties: {} },
    tier: 2,
    requiredScope: "board:read",
  },

  {
    name: "focusboard_focus_status",
    description:
      "Read the active focus session (if any) plus today's session count and focused minutes. " +
      "Read-only. Check this before suggesting Claire start something new.",
    inputSchema: { type: "object", properties: {} },
    tier: 2,
    requiredScope: "focus:read",
  },

  // ── Tier 3 — focus sessions (mutation, but append-only rows) ────────────────

  {
    name: "focusboard_start_focus_session",
    description:
      "Start a focus session, optionally tied to a board card (id from focusboard_cards). " +
      "Only one session can be active; if one is already running this returns ALREADY_ACTIVE " +
      "with a hint. Append-only and self-reversing (stop it with focusboard_stop_focus_session).",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Board card id to focus on (from focusboard_cards)" },
        planned_minutes: {
          type: "number",
          minimum: 1,
          maximum: 480,
          default: 25,
          description: "Planned length in minutes",
        },
      },
    },
    tier: 3,
    requiredScope: "focus:write",
  },

  {
    name: "focusboard_stop_focus_session",
    description:
      "Stop the active focus session and log its outcome. Returns the actual focused minutes. " +
      "NOT_FOUND if no session is running.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["progressed", "blocked", "completed", "abandoned"],
          default: "progressed",
          description: "What happened during the session",
        },
        note: { type: "string", maxLength: 1000, description: "Optional note about the session" },
      },
    },
    tier: 3,
    requiredScope: "focus:write",
  },

  // ── Tier 3 — card mutations (durable confirmation gate) ─────────────────────

  {
    name: "focusboard_add_card",
    description:
      "Propose adding a card directly to the board. Returns a confirm_token — the card is " +
      "only created after focusboard_confirm. For raw thoughts/ideas prefer focusboard_capture " +
      "(goes to the inbox for Claire to triage, no confirmation needed).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 300, description: "Card title" },
        column: { type: "string", description: "Column id (default backlog; see focusboard_cards)" },
        swimlane: { type: "string", enum: ["work", "personal"] },
        due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Due date YYYY-MM-DD" },
        tags: { type: "array", items: { type: "string" }, description: "Existing tag NAMES" },
        notes: { type: "string", maxLength: 5000 },
      },
      required: ["title"],
    },
    tier: 3,
    requiredScope: "card:write",
  },

  {
    name: "focusboard_move_card",
    description:
      "Propose moving a card to another column. Returns a confirm_token; executes only after " +
      "focusboard_confirm. The move re-reads the card at confirm time (409 STALE_STATE if it changed).",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Card id (from focusboard_cards)" },
        column: { type: "string", description: "Target column id" },
      },
      required: ["card_id", "column"],
    },
    tier: 3,
    requiredScope: "card:write",
  },

  {
    name: "focusboard_complete_card",
    description:
      "Propose completing a card (moves it to the done column). Returns a confirm_token; " +
      "executes only after focusboard_confirm.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Card id (from focusboard_cards)" },
      },
      required: ["card_id"],
    },
    tier: 3,
    requiredScope: "card:write",
  },

  {
    name: "focusboard_update_card",
    description:
      "Propose editing a card (title, notes, due date, tags, blocked reason). Returns a " +
      "confirm_token; executes only after focusboard_confirm. Pass null to clear a field.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "Card id (from focusboard_cards)" },
        title: { type: "string", minLength: 1, maxLength: 300 },
        notes: { type: "string", maxLength: 5000 },
        due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        tags: { type: "array", items: { type: "string" }, description: "Existing tag NAMES (replaces the set)" },
        blocked_reason: { type: "string", maxLength: 500 },
      },
      required: ["card_id"],
    },
    tier: 3,
    requiredScope: "card:write",
  },

  {
    name: "focusboard_move_cards",
    description:
      "Propose moving up to 20 cards in one plan — e.g. 'move all waiting-on-someone items " +
      "to blocked'. Returns ONE confirm_token covering the whole plan; after " +
      "focusboard_confirm the moves execute as per-card compare-and-swaps with versions read " +
      "FRESH at confirm time. Partial success is reported per card (a STALE_STATE on one card " +
      "does not stop the others) — re-read and re-plan any failures.",
    inputSchema: {
      type: "object",
      properties: {
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: {
              card_id: { type: "string", description: "Card id (from focusboard_cards)" },
              column: { type: "string", description: "Target column id" },
            },
            required: ["card_id", "column"],
          },
          minItems: 1,
          maxItems: 20,
          description: "The moves, one entry per card",
        },
      },
      required: ["moves"],
    },
    tier: 3,
    requiredScope: "card:write",
  },

  {
    name: "focusboard_confirm",
    description:
      "Execute a mutation previously proposed by focusboard_add_card / move_card / " +
      "complete_card / update_card / move_cards, using its confirm_token. Tokens are " +
      "single-use, expire after 5 minutes, and are bound to the proposing user — another " +
      "session cannot steal or replay them.",
    inputSchema: {
      type: "object",
      properties: {
        confirm_token: { type: "string", description: "The confirm_token from the proposal" },
      },
      required: ["confirm_token"],
    },
    tier: 3,
    requiredScope: "card:write",
  },
];

// ── MCP tool → API route dispatch table ───────────────────────────────────────
//
// Maps tool name to an async function that:
//   1. Builds a synthetic Request to the matching API route.
//   2. Calls the lazy `fetch` (the composed server.fetch) with the caller's
//      Authorization header forwarded (so ROUTE_SCOPES re-enforces).
//   3. Returns the MCP { content: [{ type: "text", text }], isError } shape.
//
// For Tier-3 card ops we forward to POST /api/confirmations (which mints the
// durable token) then return a confirmation_required result.
// focusboard_confirm dispatches to POST /api/confirmations/confirm.
// For card reads needed in previews (move_card, complete_card, update_card)
// we do an in-process GET /api/cards/:id.

type DispatchArgs = {
  args: Record<string, unknown>;
  authHeader: string;
  /** Lazy getter to avoid circular init — call at dispatch time, not at import time. */
  getFetch: () => (req: Request) => Promise<Response>;
};

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError: boolean;
};

function mcpOk(body: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: false };
}

function mcpErr(body: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
}

/** Build Request headers with auth forwarded. */
function authHeaders(authHeader: string, extra?: Record<string, string>): Headers {
  const h = new Headers({ "content-type": "application/json", authorization: authHeader });
  if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

/** Execute a synthetic GET, return parsed JSON. Throws on non-ok. */
async function inProcessGet(
  getFetch: () => (req: Request) => Promise<Response>,
  authHeader: string,
  path: string
): Promise<unknown> {
  const res = await getFetch()(new Request(`https://internal${path}`, {
    method: "GET",
    headers: authHeaders(authHeader),
  }));
  const body = await res.json() as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
  if (!res.ok || !body.ok) {
    throw Object.assign(new Error(body.error?.message ?? "Upstream error"), {
      code: body.error?.code ?? "INTERNAL",
      status: res.status,
    });
  }
  return body.data;
}

/** Execute a synthetic POST, return the full response body as-is. */
async function inProcessPost(
  getFetch: () => (req: Request) => Promise<Response>,
  authHeader: string,
  path: string,
  bodyObj: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const res = await getFetch()(new Request(`https://internal${path}`, {
    method: "POST",
    headers: authHeaders(authHeader, extraHeaders),
    body: JSON.stringify(bodyObj),
  }));
  const body = await res.json();
  return { status: res.status, body };
}

/** Read a card title for use in a preview (throws on 404). */
async function freshTitle(
  getFetch: () => (req: Request) => Promise<Response>,
  authHeader: string,
  cardId: string
): Promise<string> {
  const data = await inProcessGet(getFetch, authHeader, `/api/cards/${encodeURIComponent(cardId)}`) as { card?: { title?: string } };
  return data?.card?.title ?? cardId;
}

/** Propose a Tier-3 op via POST /api/confirmations; return a confirmation_required MCP result. */
async function proposeConfirmation(
  getFetch: () => (req: Request) => Promise<Response>,
  authHeader: string,
  tool: string,
  args: Record<string, unknown>,
  preview: string
): Promise<McpToolResult> {
  const { status, body } = await inProcessPost(getFetch, authHeader, "/api/confirmations", { tool, args, preview });
  const envelope = body as { ok: boolean; data?: { confirm_token: string; expires_in_seconds: number; preview: string }; error?: unknown };
  if (status !== 201 || !envelope.ok) {
    return mcpErr(body);
  }
  const { confirm_token, expires_in_seconds } = envelope.data!;
  return mcpOk({
    status: "confirmation_required",
    confirm_token,
    expires_in_seconds,
    preview,
    hint: "Call focusboard_confirm with this confirm_token to execute",
  });
}

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  authHeader: string,
  getFetch: () => (req: Request) => Promise<Response>
): Promise<McpToolResult> {
  const dispatch: DispatchArgs = { args, authHeader, getFetch };
  void dispatch; // used below via args/authHeader/getFetch directly

  try {
    switch (toolName) {

      // ── Tier 1 — capture ────────────────────────────────────────────────────

      case "focusboard_capture": {
        const idempotencyKey = generateUUID();
        const { status, body } = await inProcessPost(getFetch, authHeader, "/api/capture",
          { content: args.content, source: "in_app" },
          { "idempotency-key": idempotencyKey }
        );
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      case "focusboard_capture_actions": {
        const idempotencyKey = generateUUID();
        const { status, body } = await inProcessPost(getFetch, authHeader, "/api/capture/batch",
          { items: args.items },
          { "idempotency-key": idempotencyKey }
        );
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      case "focusboard_inbox": {
        const data = await inProcessGet(getFetch, authHeader, "/api/capture");
        return mcpOk({ ok: true, data });
      }

      case "focusboard_snooze_capture": {
        const captureId = args.capture_id as string;
        const { status, body } = await inProcessPost(getFetch, authHeader,
          `/api/capture/${encodeURIComponent(captureId)}/snooze`,
          { minutes: args.minutes ?? 60 }
        );
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      // ── Tier 2 — board reads ────────────────────────────────────────────────

      case "focusboard_today": {
        const data = await inProcessGet(getFetch, authHeader, "/api/today");
        return mcpOk({ ok: true, data });
      }

      case "focusboard_cards": {
        const params = new URLSearchParams();
        if (args.column) params.set("column", args.column as string);
        if (args.swimlane) params.set("swimlane", args.swimlane as string);
        if (args.q) params.set("q", args.q as string);
        if (args.limit != null) params.set("limit", String(args.limit));
        const qs = params.toString();
        const data = await inProcessGet(getFetch, authHeader, `/api/cards${qs ? `?${qs}` : ""}`);
        return mcpOk({ ok: true, data });
      }

      case "focusboard_wip": {
        const data = await inProcessGet(getFetch, authHeader, "/api/wip");
        return mcpOk({ ok: true, data });
      }

      case "focusboard_focus_history": {
        const days = (args.days as number | undefined) ?? 7;
        const data = await inProcessGet(getFetch, authHeader, `/api/focus/history?days=${days}`);
        return mcpOk({ ok: true, data });
      }

      case "focusboard_shutdown": {
        const data = await inProcessGet(getFetch, authHeader, "/api/review/daily");
        return mcpOk({ ok: true, data });
      }

      case "focusboard_week": {
        const data = await inProcessGet(getFetch, authHeader, "/api/review/weekly");
        return mcpOk({ ok: true, data });
      }

      case "focusboard_focus_status": {
        const data = await inProcessGet(getFetch, authHeader, "/api/focus/status");
        return mcpOk({ ok: true, data });
      }

      // ── Tier 3 — focus sessions (no confirmation gate) ──────────────────────

      case "focusboard_start_focus_session": {
        const reqBody: Record<string, unknown> = {};
        if (args.card_id !== undefined) reqBody.cardId = args.card_id;
        if (args.planned_minutes !== undefined) reqBody.plannedMinutes = args.planned_minutes;
        const { status, body } = await inProcessPost(getFetch, authHeader, "/api/focus/start", reqBody);
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      case "focusboard_stop_focus_session": {
        const reqBody: Record<string, unknown> = {};
        if (args.outcome !== undefined) reqBody.outcome = args.outcome;
        if (args.note !== undefined) reqBody.note = args.note;
        const { status, body } = await inProcessPost(getFetch, authHeader, "/api/focus/stop", reqBody);
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      // ── Tier 3 — card mutations via durable confirmation gate ───────────────

      case "focusboard_add_card": {
        const title = args.title as string;
        const column = (args.column as string | undefined) ?? "backlog";
        const swimlane = (args.swimlane as string | undefined) ?? "work";
        const preview = `Add card "${title}" to ${column} (${swimlane})`;
        const serverArgs: Record<string, unknown> = {
          title,
          ...(args.column !== undefined ? { column: args.column } : {}),
          ...(args.swimlane !== undefined ? { swimlane: args.swimlane } : {}),
          ...(args.due_date !== undefined ? { dueDate: args.due_date } : {}),
          ...(args.tags !== undefined ? { tags: args.tags } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
        };
        return proposeConfirmation(getFetch, authHeader, "add_card", serverArgs, preview);
      }

      case "focusboard_move_card": {
        const cardId = args.card_id as string;
        const column = args.column as string;
        const title = await freshTitle(getFetch, authHeader, cardId);
        const preview = `Move "${title}" → ${column}`;
        return proposeConfirmation(getFetch, authHeader, "move_card", { card_id: cardId, column }, preview);
      }

      case "focusboard_complete_card": {
        const cardId = args.card_id as string;
        const title = await freshTitle(getFetch, authHeader, cardId);
        const preview = `Complete "${title}"`;
        return proposeConfirmation(getFetch, authHeader, "done_card", { card_id: cardId }, preview);
      }

      case "focusboard_update_card": {
        const cardId = args.card_id as string;
        const current = await freshTitle(getFetch, authHeader, cardId);
        const fields = Object.entries({
          title: args.title,
          notes: args.notes,
          dueDate: args.due_date,
          tags: args.tags,
          blockedReason: args.blocked_reason,
        })
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k)
          .join(", ");
        const preview = `Update "${current}" (${fields})`;
        const serverArgs: Record<string, unknown> = { card_id: cardId };
        if (args.title !== undefined) serverArgs.title = args.title;
        if (args.notes !== undefined) serverArgs.notes = args.notes;
        if (args.due_date !== undefined) serverArgs.dueDate = args.due_date;
        if (args.tags !== undefined) serverArgs.tags = args.tags;
        if (args.blocked_reason !== undefined) serverArgs.blockedReason = args.blocked_reason;
        return proposeConfirmation(getFetch, authHeader, "update_card", serverArgs, preview);
      }

      case "focusboard_move_cards": {
        const moves = args.moves as { card_id: string; column: string }[];
        const lines: string[] = [];
        for (const m of moves) {
          const title = await freshTitle(getFetch, authHeader, m.card_id);
          lines.push(`Move "${title}" → ${m.column}`);
        }
        const preview = `${moves.length} move${moves.length === 1 ? "" : "s"}:\n` + lines.join("\n");
        return proposeConfirmation(getFetch, authHeader, "move_cards", { moves }, preview);
      }

      case "focusboard_confirm": {
        const confirmToken = args.confirm_token as string;
        const { status, body } = await inProcessPost(getFetch, authHeader, "/api/confirmations/confirm", {
          confirm_token: confirmToken,
        });
        const env = body as { ok: boolean };
        return status >= 200 && status < 300 && env.ok ? mcpOk(body) : mcpErr(body);
      }

      default:
        // Unknown tool — return JSON-RPC method error (caller wraps this)
        return mcpErr({ ok: false, error: { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${toolName}` } });
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return mcpErr({
      ok: false,
      error: {
        code: e.code ?? "INTERNAL",
        message: e.message ?? "Internal error",
      },
    });
  }
}

/** MCP tools/list payload (the array to embed in the result). */
export function listTools(): object[] {
  return HOSTED_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

// ── JSON-RPC handler (the core of POST /api/mcp) ──────────────────────────────
//
// This is the PROVEN stateless shape from the Phase 6.0 probe:
//   - initialize → echo client protocolVersion, capabilities, serverInfo
//   - notifications (id absent or null) → 202 empty (no JSON-RPC reply needed)
//   - ping → {}
//   - tools/list → { tools: [...] }
//   - tools/call → { content: [...], isError }
//   - unknown method → JSON-RPC error -32601
//   - unknown tool in tools/call → JSON-RPC error -32602

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

export async function handleMcpRpc(
  c: Context<AuthEnv>,
  getFetch: () => (req: Request) => Promise<Response>
): Promise<Response> {
  let rpc: JsonRpcRequest;
  try {
    rpc = (await c.req.json()) as JsonRpcRequest;
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  // Notifications: id absent or null → 202 with empty body (spec §5.2 of streamable-http MCP)
  if (rpc.id === undefined || rpc.id === null) {
    return c.body(null, 202);
  }

  const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id: rpc.id, result }, 200);
  const rpcErr = (code: number, message: string) =>
    c.json({ jsonrpc: "2.0", id: rpc.id, error: { code, message } }, 200);

  switch (rpc.method) {
    case "initialize":
      return reply({
        protocolVersion: (rpc.params?.protocolVersion as string | undefined) ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "focusboard", version: "0.2.0" },
      });

    case "ping":
      return reply({});

    case "tools/list":
      return reply({ tools: listTools() });

    case "tools/call": {
      const toolName = rpc.params?.name as string | undefined;
      const toolArgs = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      if (!toolName) return rpcErr(-32602, "Missing tool name in params.name");

      // Check tool exists
      const toolDef = HOSTED_TOOLS.find((t) => t.name === toolName);
      if (!toolDef) {
        return rpcErr(-32602, `Unknown tool: ${toolName}`);
      }

      const authHeader = c.req.header("authorization") ?? "";
      const result = await dispatchTool(toolName, toolArgs, authHeader, getFetch);
      return reply(result);
    }

    default:
      return rpcErr(-32601, `Method not found: ${rpc.method ?? "(none)"}`);
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function generateUUID(): string {
  // Construct a UUID v4 from randomBytes (node:crypto, always available).
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type { Principal };
