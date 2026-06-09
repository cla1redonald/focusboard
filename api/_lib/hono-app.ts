/**
 * The Hono application — all CLI/MCP routes live here.
 * Extracted into a separate importable module so tests can import
 * `app` directly without dealing with the bracket filename.
 *
 * Routes:
 *   GET  /api/capture         → inbox listing         (scope: capture:read)
 *   POST /api/capture         → capture / snooze / dismiss (scope: capture:write)
 *   GET  /api/tokens          → list PATs             (session only)
 *   POST /api/tokens          → create PAT            (session only)
 *   DELETE /api/tokens        → revoke PAT            (session only)
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import {
  requireScope,
  requireSession,
  authenticateWebhook,
  authenticate,
  principalHasScope,
  type AuthEnv,
} from "./auth-middleware.js";
import { resolveApiToken, SCOPES, generateToken } from "./token.js";

// ── Allowed origins (mirrors api/_lib/cors.ts) ─────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://focusboard.vercel.app",
  "https://focusboard-alpha.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isAllowedOrigin(origin: string): boolean {
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    (origin.includes("focusboard") && origin.includes("vercel.app"))
  );
}

// ── Rate-limit / snooze constants ──────────────────────────────────────────────

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const MIN_MINUTES = 1;
const MAX_MINUTES = 43200; // 30 days

// ── Supabase service client factory ───────────────────────────────────────────

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

// ── App ────────────────────────────────────────────────────────────────────────

export const app = new Hono<AuthEnv>().basePath("/api");

// CORS middleware — equivalent to api/_lib/cors.ts behaviour
app.use("*", cors({
  origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  credentials: true,
}));

// ── GET /api/capture — inbox listing ──────────────────────────────────────────

app.get("/capture", requireScope(SCOPES.CAPTURE_READ), async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  try {
    const supabase = getServiceClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("capture_queue")
      .select(
        "id, raw_content, source, status, created_at, snoozed_until, confidence, parsed_cards, processed_at"
      )
      .eq("user_id", principal.userId)
      .eq("status", "pending")
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Inbox fetch error:", error.message);
      return c.json({ error: "Failed to fetch inbox" }, 500);
    }

    return c.json({ items: data ?? [], total: (data ?? []).length });
  } catch (err) {
    console.error("Inbox unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 405 for unsupported methods on /capture
app.on(["PUT", "PATCH", "HEAD"], "/capture", (c: Context<AuthEnv>) =>
  c.json({ error: "Method not allowed" }, 405)
);

// ── POST /api/capture — capture / snooze / dismiss ────────────────────────────

app.post("/capture", async (c: Context<AuthEnv>) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const action = body.action;

  if (action === "snooze") {
    return handleSnooze(c, body);
  }
  if (action === "dismiss") {
    return handleDismiss(c, body);
  }
  return handleCapture(c, body);
});

async function handleSnooze(c: Context<AuthEnv>, body: Record<string, unknown>) {
  const principal = await authenticate(c.req.raw.headers);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  if (!principalHasScope(principal, SCOPES.CAPTURE_WRITE)) {
    return c.json({ error: "Insufficient scope" }, 403);
  }

  const { captureId, minutes: rawMinutes = 60 } = body;

  if (!captureId || typeof captureId !== "string") {
    return c.json({ error: "captureId is required" }, 400);
  }

  const minutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Number(rawMinutes) || 60));
  const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("capture_queue")
      .update({ snoozed_until: snoozedUntil })
      .eq("id", captureId)
      .eq("user_id", principal.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Snooze update error:", error.message);
      return c.json({ error: "Failed to snooze capture" }, 500);
    }
    if (!data) return c.json({ error: "Capture not found" }, 404);

    return c.json({ ok: true, snoozedUntil });
  } catch (err) {
    console.error("Snooze unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
}

async function handleDismiss(c: Context<AuthEnv>, body: Record<string, unknown>) {
  const principal = await authenticate(c.req.raw.headers);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  if (!principalHasScope(principal, SCOPES.CAPTURE_WRITE)) {
    return c.json({ error: "Insufficient scope" }, 403);
  }

  const { captureId } = body;

  if (!captureId || typeof captureId !== "string") {
    return c.json({ error: "captureId is required" }, 400);
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("capture_queue")
      .update({ status: "dismissed" })
      .eq("id", captureId)
      .eq("user_id", principal.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Dismiss update error:", error.message);
      return c.json({ error: "Failed to dismiss capture" }, 500);
    }
    if (!data) return c.json({ error: "Capture not found" }, 404);

    return c.json({ ok: true });
  } catch (err) {
    console.error("Dismiss unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
}

async function handleCapture(c: Context<AuthEnv>, body: Record<string, unknown>) {
  const { content, source = "in_app", metadata = {}, secret } = body;

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let userId: string | null = null;
  let isPatCapture = false;

  // Auth priority: PAT > webhook secret > session
  const patResolved = await resolveApiToken(
    { headers: { authorization: c.req.header("authorization") ?? "" } } as Parameters<typeof resolveApiToken>[0]
  );

  if (patResolved) {
    if (!principalHasScope(
      { userId: patResolved.userId, scopes: patResolved.scopes, kind: "pat" },
      SCOPES.CAPTURE_WRITE
    )) {
      return c.json({ error: "Insufficient scope" }, 403);
    }
    userId = patResolved.userId;
    isPatCapture = true;
  } else if (secret) {
    const webhookPrincipal = authenticateWebhook(secret);
    if (!webhookPrincipal) {
      return c.json({ error: "Invalid secret" }, 401);
    }
    userId = webhookPrincipal.userId;
  } else {
    const bearerToken = c.req.header("authorization")?.replace("Bearer ", "");
    if (!bearerToken) return c.json({ error: "Unauthorized" }, 401);
    const authClient = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error } = await authClient.auth.getUser(bearerToken);
    if (error || !user) return c.json({ error: "Unauthorized" }, 401);
    userId = user.id;
  }

  if (!userId) return c.json({ error: "User ID required" }, 400);

  if (typeof content !== "string" || !content.trim()) {
    return c.json({ error: "Content is required" }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (isPatCapture) {
    // Rate limit
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
    const { count } = await supabase
      .from("capture_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", windowStart);

    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    // Idempotency pre-check
    const idempotencyKey = c.req.header("idempotency-key");
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from("capture_queue")
        .select("id")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existing) {
        return c.json({
          success: true,
          message: "Duplicate capture — returning existing",
          captureId: (existing as { id: string }).id,
        });
      }
    }
  }

  const validSources = ["email", "slack", "shortcut", "browser", "whatsapp", "in_app"];
  const safeSource = validSources.includes(source as string) ? (source as string) : "in_app";

  const metadataObj = (metadata && typeof metadata === "object" && !Array.isArray(metadata))
    ? (metadata as Record<string, unknown>)
    : {};

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    status: "pending",
    source: safeSource,
    raw_content: (content as string).trim().substring(0, 10000),
    raw_metadata: (() => {
      const serialized = JSON.stringify(metadataObj);
      if (serialized.length > 5120) return {};
      return metadataObj;
    })(),
  };

  if (isPatCapture) {
    const idempotencyKey = c.req.header("idempotency-key");
    if (idempotencyKey) {
      insertPayload.idempotency_key = idempotencyKey;
    }
  }

  try {
    const { data, error: insertError } = await supabase
      .from("capture_queue")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const idempotencyKey = c.req.header("idempotency-key");
        if (idempotencyKey) {
          const { data: raced } = await supabase
            .from("capture_queue")
            .select("id")
            .eq("user_id", userId)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          return c.json({
            success: true,
            message: "Duplicate capture — returning existing",
            captureId: (raced as { id: string } | null)?.id ?? null,
          });
        }
      }

      console.error("Capture insert error:", insertError.message);
      return c.json({ error: "Failed to save capture" }, 500);
    }

    const host = c.req.header("host");
    const processUrl = `https://${host}/api/capture/process`;
    const internalSecret = process.env.CAPTURE_INTERNAL_SECRET;
    waitUntil(
      fetch(processUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capture_id: (data as { id: string }).id,
          user_id: userId,
          internal_secret: internalSecret,
          auto_add: isPatCapture ? false : true,
        }),
      }).catch((err) => console.error("Process trigger failed:", err))
    );

    return c.json({
      success: true,
      message: `Captured from ${safeSource}`,
      captureId: (data as { id: string }).id,
    });
  } catch (err) {
    console.error("Capture unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
}

// ── GET /api/tokens — list PATs ────────────────────────────────────────────────

app.get("/tokens", requireSession, async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("api_tokens")
      .select("id, name, scopes, last_used_at, created_at, revoked_at")
      .eq("user_id", principal.userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Token list error:", error.message);
      return c.json({ error: "Failed to list tokens" }, 500);
    }

    return c.json({ tokens: data ?? [] });
  } catch (err) {
    console.error("Token list unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── POST /api/tokens — create PAT ─────────────────────────────────────────────

const ALLOWED_SCOPES = new Set<string>([SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE]);

app.post("/tokens", requireSession, async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { name?: unknown; scopes?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown; scopes?: unknown };
  } catch {
    body = {};
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);
  if (name.length > 100) return c.json({ error: "name must be 100 characters or fewer" }, 400);

  let scopes: string[];
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes)) {
      return c.json({ error: "scopes must be an array" }, 400);
    }
    const requested = body.scopes as unknown[];
    for (const s of requested) {
      if (typeof s !== "string" || !ALLOWED_SCOPES.has(s)) {
        return c.json({
          error: `Invalid scope "${String(s)}". Allowed: capture:read, capture:write`,
        }, 400);
      }
    }
    scopes = requested as string[];
  } else {
    scopes = [SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE];
  }

  const { plaintext, hash } = generateToken();

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("api_tokens")
      .insert({ user_id: principal.userId, name, token_hash: hash, scopes })
      .select("id, name")
      .single();

    if (error) {
      console.error("Token create error:", error.message);
      return c.json({ error: "Failed to create token" }, 500);
    }

    return c.json(
      { token: plaintext, id: (data as { id: string }).id, name: (data as { name: string }).name },
      201
    );
  } catch (err) {
    console.error("Token create unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── DELETE /api/tokens — revoke PAT ───────────────────────────────────────────

app.delete("/tokens", requireSession, async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { id?: unknown };
  try {
    body = (await c.req.json()) as { id?: unknown };
  } catch {
    body = {};
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return c.json({ error: "id is required" }, 400);

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", principal.userId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Token revoke error:", error.message);
      return c.json({ error: "Failed to revoke token" }, 500);
    }
    if (!data) return c.json({ error: "Token not found" }, 404);

    return c.json({ ok: true });
  } catch (err) {
    console.error("Token revoke unexpected error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
