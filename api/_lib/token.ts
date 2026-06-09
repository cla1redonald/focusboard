import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "crypto";
import { waitUntil } from "@vercel/functions";

/**
 * Personal Access Token (PAT) helpers — the single place that owns token format,
 * hashing, resolution, and scope checks. Used by the issuance API (web session) and
 * by every CLI/MCP-facing endpoint (Bearer fb_pat_...).
 *
 * Storage model: we persist ONLY the SHA-256 hash. The plaintext is returned once at
 * creation and never recoverable. Resolution hashes the incoming token and looks it up.
 */

const PAT_PREFIX = "fb_pat_";

export const SCOPES = {
  CAPTURE_READ: "capture:read",
  CAPTURE_WRITE: "capture:write",
  BOARD_READ: "board:read", // Phase 2 — read-only board access (today/cards/wip)
  FOCUS_READ: "focus:read", // Phase 3 — focus session status/history
  FOCUS_WRITE: "focus:write", // Phase 3 — start/stop focus sessions (append-only table)
  CARD_WRITE: "card:write", // reserved for Phase 4
} as const;

export function isPat(token: string | undefined | null): boolean {
  return typeof token === "string" && token.startsWith(PAT_PREFIX);
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Mint a new token. Returns the plaintext (show once) and the hash (store this). */
export function generateToken(): { plaintext: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${PAT_PREFIX}${secret}`;
  return { plaintext, hash: hashToken(plaintext) };
}

/** Extract the bearer token from an Authorization header value (case-insensitive). */
export function bearerToken(authHeader: string | undefined | null): string | undefined {
  if (typeof authHeader !== "string") return undefined;
  const stripped = authHeader.replace(/^Bearer\s+/i, "");
  return stripped === authHeader ? undefined : stripped;
}

export type ResolvedToken = { userId: string; scopes: string[]; tokenId: string };

/**
 * Resolve an `Authorization: Bearer fb_pat_...` header to its user + scopes, or null.
 * Returns null for non-PAT tokens (so callers can fall back to session auth).
 * Stamps last_used_at via waitUntil (survives the response being sent; never blocks it).
 * Uses the service-role key (bypasses RLS).
 */
export async function resolveApiToken(
  authHeader: string | undefined | null
): Promise<ResolvedToken | null> {
  const token = bearerToken(authHeader);
  if (!isPat(token)) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase credentials not configured");
    return null;
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const hash = hashToken(token as string);

  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, user_id, scopes, revoked_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  waitUntil(
    Promise.resolve(
      supabase
        .from("api_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", data.id)
    ).then(
      () => {},
      () => {}
    )
  );

  return { userId: data.user_id, scopes: data.scopes ?? [], tokenId: data.id };
}

export function hasScope(resolved: ResolvedToken, scope: string): boolean {
  return resolved.scopes.includes(scope);
}
