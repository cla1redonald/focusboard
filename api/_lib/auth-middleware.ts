import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { resolveApiToken, hasScope, isPat, isOAuthToken, resolveOAuthToken, bearerToken, SCOPES } from "./token.js";
import { fail } from "./envelope.js";

// ── Principal types ────────────────────────────────────────────────────────────

export type PrincipalKind = "pat" | "oauth" | "webhook" | "session";

export type Principal = {
  userId: string;
  scopes: string[] | "ALL";
  kind: PrincipalKind;
};

// ── Route → required policy table (single source of truth for API policy) ─────
//
// ENFORCED by enforceRouteScopes (registered app-wide in hono-app.ts), not just
// documentation: a route that matches a handler but has no entry here is DENIED
// (403 FORBIDDEN) — deny-by-default, fails closed. A test in route-scopes.test.ts
// additionally asserts every registered route has an entry, so a miss fails CI
// before it fails a request.
//
// Values:
//   a scope string  → any principal holding that scope passes
//   "SESSION_ONLY"  → only a web-session principal passes (PATs must not manage PATs)
//   "INLINE_AUTH"   → the handler authenticates itself (POST /api/capture only —
//                     webhook auth reads the body, which middleware must not consume)
//   "PUBLIC"        → no auth (405 method stubs only)

export const ROUTE_SCOPES: Record<string, string> = {
  "GET /api/health/deep": "PUBLIC",
  "GET /api/me": SCOPES.CAPTURE_READ,
  "GET /api/today": SCOPES.BOARD_READ,
  "GET /api/focus/status": SCOPES.FOCUS_READ,
  "GET /api/focus/history": SCOPES.FOCUS_READ,
  "POST /api/focus/start": SCOPES.FOCUS_WRITE,
  "POST /api/focus/stop": SCOPES.FOCUS_WRITE,
  // Digests are board-level views: their responses carry focus data as
  // AGGREGATES ONLY (raw sessions stay behind focus:read on /api/focus/*).
  "GET /api/review/daily": SCOPES.BOARD_READ,
  "GET /api/review/weekly": SCOPES.BOARD_READ,
  "POST /api/capture/batch": SCOPES.CAPTURE_WRITE,
  "GET /api/cards": SCOPES.BOARD_READ,
  "GET /api/cards/:id": SCOPES.BOARD_READ,
  "POST /api/cards": SCOPES.CARD_WRITE,
  "PATCH /api/cards/:id": SCOPES.CARD_WRITE,
  "POST /api/cards/:id/move": SCOPES.CARD_WRITE,
  "POST /api/cards/:id/done": SCOPES.CARD_WRITE,
  "POST /api/cards/batch-move": SCOPES.CARD_WRITE,
  "GET /api/wip": SCOPES.BOARD_READ,
  "GET /api/capture": SCOPES.CAPTURE_READ,
  "POST /api/capture": "INLINE_AUTH",
  "PUT /api/capture": "PUBLIC",
  "PATCH /api/capture": "PUBLIC",
  "HEAD /api/capture": "PUBLIC",
  "POST /api/capture/:id/snooze": SCOPES.CAPTURE_WRITE,
  "POST /api/capture/:id/dismiss": SCOPES.CAPTURE_WRITE,
  "GET /api/tokens": "SESSION_ONLY",
  "POST /api/tokens": "SESSION_ONLY",
  "DELETE /api/tokens/:id": "SESSION_ONLY",
  // Phase 6.1: durable confirmation gate — both routes require card:write
  // (every gated tool mutates cards).
  "POST /api/confirmations": SCOPES.CARD_WRITE,
  "POST /api/confirmations/confirm": SCOPES.CARD_WRITE,
  // Phase 6.2: OAuth endpoints — RFC-shaped responses, envelope-exempt.
  // All PUBLIC (the authorization flow authenticates via Supabase creds, not Bearer).
  "POST /api/oauth/register": "PUBLIC",
  "GET /api/oauth/authorize": "PUBLIC",
  "POST /api/oauth/authorize": "PUBLIC",
  "POST /api/oauth/token": "PUBLIC",
  // Phase 6.2: MCP endpoint — lowest scope to enter; per-tool enforcement in dispatch.
  "POST /api/mcp": SCOPES.CAPTURE_READ,
  "GET /api/mcp": "PUBLIC",
  "DELETE /api/mcp": "PUBLIC",
};

// ── Core authenticate function ─────────────────────────────────────────────────

/**
 * Resolve a principal from the request headers.
 * Priority: PAT > webhook secret > session JWT.
 * Returns null if none of the three methods succeed.
 */
export async function authenticate(headers: Headers): Promise<Principal | null> {
  const authHeader = headers.get("authorization");
  const token = bearerToken(authHeader);

  // 1. PAT — fb_pat_... prefix
  if (isPat(token)) {
    const resolved = await resolveApiToken(authHeader);
    if (resolved) {
      return { userId: resolved.userId, scopes: resolved.scopes, kind: "pat" };
    }
    // PAT prefix present but lookup failed — do NOT fall through to session
    return null;
  }

  // 2. OAuth access token — fb_oat_... prefix
  if (isOAuthToken(token)) {
    const resolved = await resolveOAuthToken(authHeader);
    if (resolved) {
      return { userId: resolved.userId, scopes: resolved.scopes, kind: "oauth" };
    }
    // OAuth prefix present but lookup failed (expired/revoked) — do NOT fall through
    return null;
  }

  // 3. Webhook secret (passed as JSON body field; the capture route calls
  //    authenticateWebhook() explicitly because reading the body here would
  //    consume it before the handler runs).

  // 4. Session JWT (Supabase access token)
  if (token) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return null;
    try {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        return { userId: user.id, scopes: "ALL", kind: "session" };
      }
    } catch {
      // fall through to null
    }
  }

  return null;
}

/**
 * Resolve webhook-secret auth from the secret field already parsed from the body.
 * Returns a Principal or null.
 */
export function authenticateWebhook(secret: unknown): Principal | null {
  const expectedSecret = process.env.WEBHOOK_SECRET;
  const userId = process.env.FOCUSBOARD_USER_ID ?? null;
  if (
    !expectedSecret ||
    !userId ||
    typeof secret !== "string" ||
    secret.length !== expectedSecret.length
  ) {
    return null;
  }
  try {
    if (!timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret))) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    userId,
    scopes: [SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE],
    kind: "webhook",
  };
}

/** Check whether a principal holds a given scope (session principals hold ALL). */
export function principalHasScope(principal: Principal, scope: string): boolean {
  if (principal.scopes === "ALL") return true;
  return hasScope(
    { userId: principal.userId, scopes: principal.scopes, tokenId: "" },
    scope
  );
}

// ── Hono context type extension ────────────────────────────────────────────────

export type AuthEnv = {
  Variables: {
    principal: Principal;
  };
};

// ── App-wide enforcement middleware ────────────────────────────────────────────

/**
 * enforceRouteScopes — registered once with app.use("*").
 *
 * Looks up the matched route in ROUTE_SCOPES and enforces its policy BEFORE any
 * handler runs. Handlers never do their own header auth (POST /api/capture's
 * body-secret webhook path is the single, explicit exception). A matched route
 * with no table entry is denied — adding a route without declaring its policy
 * fails closed, not open.
 */
export const enforceRouteScopes = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return next(); // CORS preflight — handled by the cors middleware
  }

  // The concrete (non-middleware) route this request matched, if any.
  const concrete = matchedRoutes(c).filter(
    (r) => r.method !== "ALL" && !r.path.includes("*")
  );
  if (concrete.length === 0) {
    return next(); // no handler matched — Hono returns its 404
  }

  const route = concrete[concrete.length - 1];
  const policy = ROUTE_SCOPES[`${route.method} ${route.path}`];

  if (!policy) {
    console.error(`Route ${route.method} ${route.path} missing from ROUTE_SCOPES`);
    return fail(c, 403, "FORBIDDEN", "Route is not registered in the scope table");
  }
  if (policy === "PUBLIC" || policy === "INLINE_AUTH") {
    return next();
  }

  const principal = await authenticate(c.req.raw.headers);
  if (!principal) {
    return fail(c, 401, "NOT_AUTHENTICATED", "Missing or invalid credentials");
  }
  if (policy === "SESSION_ONLY") {
    if (principal.kind !== "session") {
      return fail(c, 403, "SESSION_REQUIRED", "Only a signed-in session may manage tokens");
    }
  } else if (!principalHasScope(principal, policy)) {
    return fail(c, 403, "INSUFFICIENT_SCOPE", `Requires scope ${policy}`);
  }

  c.set("principal", principal);
  await next();
});
