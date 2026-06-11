/**
 * Confirmation executor — maps an allowlisted tool name + stored args to an
 * in-process HTTP dispatch through the Hono app itself.
 *
 * The caller's own Authorization header rides along, so ROUTE_SCOPES
 * re-enforces card:write on every executed operation in the same invocation.
 * No self-HTTP: the request is dispatched via app.fetch() with a synthetic URL.
 *
 * For move_card, done_card, and update_card the executor reads a FRESH version
 * from GET /api/cards/:id before the mutation — this preserves the 4a CAS
 * contract (the version is always fresh at confirm time, not stale from when
 * the proposal was made).
 */

import type { Hono } from "hono";
import type { AuthEnv } from "./auth-middleware.js";

// The allowlist is the canonical set of tools that may route through the
// confirmation gate. Anything not in this list is rejected at proposal time.
export const CONFIRMATION_TOOL_ALLOWLIST = new Set([
  "add_card",
  "move_card",
  "done_card",
  "update_card",
  "move_cards",
]);

export type ExecutorArgs = Record<string, unknown>;

/**
 * Execute a confirmed operation in-process via app.fetch().
 * Returns the parsed response body (the ok/data envelope contents).
 * Throws if the executed route returns a non-ok response.
 */
export async function executeConfirmedOp(
  app: Hono<AuthEnv>,
  tool: string,
  args: ExecutorArgs,
  authHeader: string
): Promise<unknown> {
  switch (tool) {
    case "add_card":
      return dispatchInProcess(app, authHeader, "POST", "/api/cards", {
        title: args.title,
        ...(args.column !== undefined ? { column: args.column } : {}),
        ...(args.swimlane !== undefined ? { swimlane: args.swimlane } : {}),
        ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
      });

    case "move_card": {
      const cardId = args.card_id as string;
      // Fresh version at confirm time (the CAS contract).
      const freshVersion = await getFreshVersion(app, authHeader, cardId);
      return dispatchInProcess(app, authHeader, "POST", `/api/cards/${encodeURIComponent(cardId)}/move`, {
        version: freshVersion,
        column: args.column,
      });
    }

    case "done_card": {
      const cardId = args.card_id as string;
      const freshVersion = await getFreshVersion(app, authHeader, cardId);
      return dispatchInProcess(app, authHeader, "POST", `/api/cards/${encodeURIComponent(cardId)}/done`, {
        version: freshVersion,
      });
    }

    case "update_card": {
      const cardId = args.card_id as string;
      const freshVersion = await getFreshVersion(app, authHeader, cardId);
      // Only include keys that were explicitly provided in args.
      const patchBody: Record<string, unknown> = { version: freshVersion };
      const patchFields = ["title", "notes", "dueDate", "tags", "blockedReason"] as const;
      for (const field of patchFields) {
        if (args[field] !== undefined) patchBody[field] = args[field];
      }
      return dispatchInProcess(app, authHeader, "PATCH", `/api/cards/${encodeURIComponent(cardId)}`, patchBody);
    }

    case "move_cards":
      // batch-move reads versions at execution time itself — no pre-read needed.
      return dispatchInProcess(app, authHeader, "POST", "/api/cards/batch-move", {
        moves: (args.moves as { card_id: string; column: string }[]).map((m) => ({
          id: m.card_id,
          to: m.column,
        })),
      });

    default:
      throw new Error(`Unknown tool "${tool}" — not in the confirmation allowlist`);
  }
}

/**
 * Read the current version of a card via in-process GET /api/cards/:id.
 * Throws an ApiError-shaped error if the card is not found or the fetch fails.
 */
async function getFreshVersion(
  app: Hono<AuthEnv>,
  authHeader: string,
  cardId: string
): Promise<number | null> {
  const res = await app.fetch(
    new Request(`https://internal/api/cards/${encodeURIComponent(cardId)}`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        authorization: authHeader,
      },
    })
  );

  const body = (await res.json()) as { ok: boolean; data?: { card?: { version?: number | null } }; error?: unknown };
  if (!res.ok || !body.ok) {
    // Surface the upstream error — the caller will map it to a 404 or 409.
    throw Object.assign(new Error("Card not found during fresh-version read"), {
      upstreamStatus: res.status,
      upstreamBody: body,
    });
  }
  return body.data?.card?.version ?? null;
}

/**
 * Dispatch a synthetic request in-process through the Hono app.
 * The caller's Authorization header is forwarded so scope checks fire again.
 * Returns the response body's `data` field on success; throws on error.
 */
async function dispatchInProcess(
  app: Hono<AuthEnv>,
  authHeader: string,
  method: string,
  path: string,
  body: unknown
): Promise<unknown> {
  const res = await app.fetch(
    new Request(`https://internal${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: authHeader,
      },
      body: JSON.stringify(body),
    })
  );

  const parsed = (await res.json()) as { ok: boolean; data?: unknown; error?: { code: string; message: string; hint?: string } };

  if (!res.ok || !parsed.ok) {
    const err = parsed.error ?? { code: "INTERNAL", message: "Execution failed" };
    // Re-throw with the same shape ApiError uses so the caller can propagate it.
    const e = Object.assign(new Error(err.message), {
      code: err.code,
      hint: err.hint,
      status: res.status,
    });
    throw e;
  }

  return parsed.data;
}
