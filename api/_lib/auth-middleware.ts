import { createMiddleware } from "hono/factory";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { resolveApiToken, hasScope, isPat, SCOPES } from "./token.js";

// ── Principal types ────────────────────────────────────────────────────────────

export type PrincipalKind = "pat" | "webhook" | "session";

export type Principal = {
  userId: string;
  scopes: string[] | "ALL";
  kind: PrincipalKind;
};

// ── Route → required scope table (single source of truth for API policy) ──────
//
// "ALL" means any authenticated principal passes (session-only routes use
// requireSession instead, which enforces kind === "session").
//
// Deny-by-default: any route not listed here requires auth and fails closed
// (the requireScope middleware returns 403 if the scope is not in the table).

export const ROUTE_SCOPES: Record<string, string> = {
  "GET /capture":    SCOPES.CAPTURE_READ,
  "POST /capture":   SCOPES.CAPTURE_WRITE,
  "GET /tokens":     "SESSION_ONLY",
  "POST /tokens":    "SESSION_ONLY",
  "DELETE /tokens":  "SESSION_ONLY",
};

// ── Core authenticate function ─────────────────────────────────────────────────

/**
 * Resolve a principal from the request headers.
 * Priority: PAT > webhook secret > session JWT.
 * Returns null if none of the three methods succeed.
 */
export async function authenticate(headers: Headers): Promise<Principal | null> {
  const authHeader = headers.get("authorization") ?? undefined;
  const bearerToken = authHeader?.replace("Bearer ", "");

  // 1. PAT — fb_pat_... prefix
  if (isPat(bearerToken)) {
    // resolveApiToken needs a VercelRequest-like object; we supply a minimal shim.
    const shimReq = { headers: { authorization: authHeader ?? "" } };
    const resolved = await resolveApiToken(
      shimReq as Parameters<typeof resolveApiToken>[0]
    );
    if (resolved) {
      return { userId: resolved.userId, scopes: resolved.scopes, kind: "pat" };
    }
    // PAT prefix present but lookup failed — do NOT fall through to session
    return null;
  }

  // 2. Webhook secret (passed as JSON body field; we receive it separately via context)
  // Webhook auth is handled inline in the capture route because it reads the body.
  // This function returns null here; the route calls authenticateWebhook() explicitly.

  // 3. Session JWT (Supabase access token)
  if (bearerToken) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return null;
    try {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
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

// ── Hono middlewares ───────────────────────────────────────────────────────────

/**
 * requireScope(scope) — Hono middleware.
 * Authenticates the request (PAT or session); attaches the principal to context.
 * Returns 401 if no valid principal, 403 if the principal lacks the required scope.
 */
export function requireScope(scope: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const principal = await authenticate(c.req.raw.headers);
    if (!principal) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!principalHasScope(principal, scope)) {
      return c.json({ error: "Insufficient scope" }, 403);
    }
    c.set("principal", principal);
    await next();
  });
}

/**
 * requireSession — Hono middleware for token-management routes.
 * Only session principals may manage tokens — PATs must NOT create/revoke tokens.
 */
export const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  const principal = await authenticate(c.req.raw.headers);
  if (!principal) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (principal.kind !== "session") {
    return c.json({ error: "Forbidden: session required" }, 403);
  }
  c.set("principal", principal);
  await next();
});
