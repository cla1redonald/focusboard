import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The API response envelope — the single response contract for every route in the
 * Hono app, frozen BEFORE the CLI/MCP clients are built so they encode exactly one
 * shape:
 *
 *   success: { ok: true,  data: {...} }
 *   failure: { ok: false, error: { code, message, hint? } }
 *
 * Error codes are STABLE — clients (and agents reading MCP output) branch on them.
 * Add codes; never rename them. 409/STALE_STATE is reserved for the Phase-4
 * optimistic-locking conflict contract.
 */

export const ERROR_CODES = {
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED", // 401 — no/invalid credentials
  INSUFFICIENT_SCOPE: "INSUFFICIENT_SCOPE", // 403 — principal lacks the route's scope
  SESSION_REQUIRED: "SESSION_REQUIRED", // 403 — PATs may not manage tokens
  FORBIDDEN: "FORBIDDEN", // 403 — fail-closed (route missing from scope table)
  VALIDATION: "VALIDATION", // 400 — bad input
  NOT_FOUND: "NOT_FOUND", // 404
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED", // 405
  RATE_LIMITED: "RATE_LIMITED", // 429
  STALE_STATE: "STALE_STATE", // 409 — reserved for Phase 4
  INTERNAL: "INTERNAL", // 500
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true as const, data }, status);
}

export function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  hint?: string
) {
  return c.json(
    { ok: false as const, error: { code, message, ...(hint ? { hint } : {}) } },
    status
  );
}
