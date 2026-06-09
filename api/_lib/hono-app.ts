/**
 * The Hono application — all CLI/MCP routes live here.
 * Extracted into a separate importable module so tests can import
 * `app` directly without dealing with the bracket filename.
 *
 * Routes (auth policy lives in ROUTE_SCOPES, enforced app-wide):
 *   GET    /api/capture              → inbox listing      (scope: capture:read)
 *   POST   /api/capture              → capture            (PAT | webhook secret | session)
 *   POST   /api/capture/:id/snooze   → snooze a capture   (scope: capture:write)
 *   POST   /api/capture/:id/dismiss  → dismiss a capture  (scope: capture:write)
 *   GET    /api/tokens               → list PATs          (session only)
 *   POST   /api/tokens               → create PAT         (session only)
 *   DELETE /api/tokens/:id           → revoke PAT         (session only)
 *
 * Every response uses the envelope from envelope.ts:
 *   { ok: true, data } | { ok: false, error: { code, message, hint? } }
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import {
  enforceRouteScopes,
  authenticateWebhook,
  principalHasScope,
  type AuthEnv,
} from "./auth-middleware.js";
import { resolveApiToken, SCOPES, generateToken } from "./token.js";
import { ok, fail } from "./envelope.js";
import { TRIAGE_STATUSES } from "../../src/app/captureTypes.js";
import { loadBoard, slimCard, tagNameResolver } from "./board.js";
import { buildTodayPlan, buildTodayDailyPlan, getActiveCards } from "../../src/app/today.js";
import { filterCards, DEFAULT_FILTER } from "../../src/app/filters.js";

// ── Allowed origins ────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://focusboard.vercel.app",
  "https://focusboard-alpha.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

/**
 * Exact allowlist match, or a focusboard* deployment on *.vercel.app — checked on
 * the parsed HOSTNAME, not by substring (a substring check admits
 * https://focusboard.vercel.app.evil.com).
 */
export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.startsWith("focusboard") &&
      hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
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

app.use("*", cors({
  origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  credentials: true,
}));

// Auth policy for every route below — see ROUTE_SCOPES in auth-middleware.ts.
app.use("*", enforceRouteScopes);

// ── GET /api/health/deep — multi-segment routing liveness ─────────────────────
//
// Deliberately TWO path segments: Vercel's filesystem router silently dropped
// multi-segment paths to the old [...path].ts catch-all (platform 404, function
// never invoked) while single-segment routes worked. The runtime-smoke gate
// asserts this returns 200, so a routing regression fails the deploy gate
// instead of shipping silently.

app.get("/health/deep", (c: Context<AuthEnv>) => ok(c, { deep: true }));

// ── GET /api/me — who am I (token validation for fb auth status/login) ────────

app.get("/me", (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  return ok(c, {
    userId: principal.userId,
    kind: principal.kind,
    scopes: principal.scopes === "ALL" ? ["*"] : principal.scopes,
  });
});

// ── GET /api/capture — inbox listing ──────────────────────────────────────────

app.get("/capture", async (c: Context<AuthEnv>) => {
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
      .in("status", [...TRIAGE_STATUSES])
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Inbox fetch error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to fetch inbox");
    }

    return ok(c, { items: data ?? [], total: (data ?? []).length });
  } catch (err) {
    console.error("Inbox unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// 405 for unsupported methods on /capture
app.on(["PUT", "PATCH", "HEAD"], "/capture", (c: Context<AuthEnv>) =>
  fail(c, 405, "METHOD_NOT_ALLOWED", "Method not allowed")
);

// ── POST /api/capture/:id/snooze ───────────────────────────────────────────────

app.post("/capture/:id/snooze", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  const captureId = c.req.param("id");

  let body: { minutes?: unknown };
  try {
    body = (await c.req.json()) as { minutes?: unknown };
  } catch {
    body = {};
  }

  const minutes = Math.max(
    MIN_MINUTES,
    Math.min(MAX_MINUTES, Number(body.minutes) || 60)
  );
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
      return fail(c, 500, "INTERNAL", "Failed to snooze capture");
    }
    if (!data) return fail(c, 404, "NOT_FOUND", "Capture not found");

    return ok(c, { captureId, snoozedUntil });
  } catch (err) {
    console.error("Snooze unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── POST /api/capture/:id/dismiss ──────────────────────────────────────────────

app.post("/capture/:id/dismiss", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  const captureId = c.req.param("id");

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
      return fail(c, 500, "INTERNAL", "Failed to dismiss capture");
    }
    if (!data) return fail(c, 404, "NOT_FOUND", "Capture not found");

    return ok(c, { captureId });
  } catch (err) {
    console.error("Dismiss unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── POST /api/capture — capture ────────────────────────────────────────────────
//
// INLINE_AUTH in ROUTE_SCOPES: the webhook path authenticates with a secret in the
// JSON body, so this handler must read the body before it can resolve a principal.
// Auth priority mirrors authenticate(): PAT > webhook secret > session.

app.post("/capture", async (c: Context<AuthEnv>) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (typeof body.action === "string") {
    return fail(
      c,
      400,
      "VALIDATION",
      `action="${body.action}" is no longer supported on POST /api/capture`,
      "Use POST /api/capture/:id/snooze or POST /api/capture/:id/dismiss"
    );
  }

  const { content, source = "in_app", metadata = {}, secret } = body;

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  let userId: string | null = null;
  let isPatCapture = false;

  const patResolved = await resolveApiToken(c.req.header("authorization"));

  if (patResolved) {
    if (!principalHasScope(
      { userId: patResolved.userId, scopes: patResolved.scopes, kind: "pat" },
      SCOPES.CAPTURE_WRITE
    )) {
      return fail(c, 403, "INSUFFICIENT_SCOPE", `Requires scope ${SCOPES.CAPTURE_WRITE}`);
    }
    userId = patResolved.userId;
    isPatCapture = true;
  } else if (secret) {
    const webhookPrincipal = authenticateWebhook(secret);
    if (!webhookPrincipal) {
      return fail(c, 401, "NOT_AUTHENTICATED", "Invalid secret");
    }
    userId = webhookPrincipal.userId;
  } else {
    const sessionToken = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!sessionToken) return fail(c, 401, "NOT_AUTHENTICATED", "Missing or invalid credentials");
    const authClient = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error } = await authClient.auth.getUser(sessionToken);
    if (error || !user) return fail(c, 401, "NOT_AUTHENTICATED", "Missing or invalid credentials");
    userId = user.id;
  }

  if (!userId) return fail(c, 400, "VALIDATION", "User ID required");

  if (typeof content !== "string" || !content.trim()) {
    return fail(c, 400, "VALIDATION", "Content is required");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  if (isPatCapture) {
    // Rate limit (per user — single-user app; revisit per-token when multi-device)
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
    const { count } = await supabase
      .from("capture_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", windowStart);

    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      return fail(c, 429, "RATE_LIMITED", "Rate limit exceeded", "Retry in 60 seconds");
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
        return ok(c, {
          captureId: (existing as { id: string }).id,
          duplicate: true,
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

          return ok(c, {
            captureId: (raced as { id: string } | null)?.id ?? null,
            duplicate: true,
          });
        }
      }

      console.error("Capture insert error:", insertError.message);
      return fail(c, 500, "INTERNAL", "Failed to save capture");
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

    return ok(c, {
      captureId: (data as { id: string }).id,
      source: safeSource,
    });
  } catch (err) {
    console.error("Capture unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── Read-only board (Phase 2, scope board:read) ───────────────────────────────
//
// Semantics are IMPORTED from src/app (today.ts, filters.ts) — the same functions
// the web app renders from — so the API cannot drift from the web (the inbox
// status-filter lesson). All three routes 404 with a hint when no board exists.

async function boardFor(c: Context<AuthEnv>) {
  const principal = c.get("principal");
  const board = await loadBoard(principal.userId);
  if (!board) {
    return { board: null, response: fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board") };
  }
  return { board, response: null };
}

app.get("/today", async (c: Context<AuthEnv>) => {
  try {
    const { board, response } = await boardFor(c);
    if (!board) return response!;
    const resolveTags = tagNameResolver(board.state.tags);
    const plan = buildTodayPlan(board.cards, board.columns);
    const daily = buildTodayDailyPlan(board.state.dailyPlan, board.cards, board.columns);
    return ok(c, {
      date: daily.date,
      activeCount: plan.activeCount,
      dailyPlan: {
        main: daily.main ? slimCard(daily.main, resolveTags) : null,
        support: daily.support.map((card) => slimCard(card, resolveTags)),
        completedCount: daily.completedCount,
        plannedCount: daily.plannedCount,
      },
      recommendations: plan.recommendations.map((r) => ({
        card: slimCard(r.card, resolveTags),
        reasons: r.reasons.map((reason) => reason.label),
        score: r.score,
      })),
      attention: {
        overdue: plan.attention.overdue.map((card) => slimCard(card, resolveTags)),
        dueToday: plan.attention.dueToday.map((card) => slimCard(card, resolveTags)),
        blocked: plan.attention.blocked.map((card) => slimCard(card, resolveTags)),
        stale: plan.attention.stale.map((card) => slimCard(card, resolveTags)),
      },
      wipPressure: plan.wipPressure.map((p) => ({
        column: p.column.id,
        columnTitle: p.column.title,
        count: p.count,
        limit: p.limit,
      })),
    });
  } catch (err) {
    console.error("Today unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.get("/cards", async (c: Context<AuthEnv>) => {
  try {
    const { board, response } = await boardFor(c);
    if (!board) return response!;

    const column = c.req.query("column") ?? "";
    const q = c.req.query("q") ?? "";
    const swimlane = c.req.query("swimlane") ?? "";
    const limitRaw = Number(c.req.query("limit") ?? 100);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 100));

    if (column && !board.columns.some((col) => col.id === column)) {
      return fail(
        c, 400, "VALIDATION", `Unknown column "${column}"`,
        `Valid columns: ${board.columns.map((col) => col.id).join(", ")}`
      );
    }

    // Same matcher the web app's search/filter uses (filters.ts).
    let cards = filterCards(getActiveCards(board.cards, board.columns), {
      ...DEFAULT_FILTER,
      search: q,
      columns: column ? [column] : [],
    });
    if (swimlane) {
      cards = cards.filter((card) => (card.swimlane ?? "work") === swimlane);
    }
    cards.sort((a, b) =>
      a.column === b.column ? (a.order ?? 0) - (b.order ?? 0) : a.column.localeCompare(b.column)
    );

    const resolveTags = tagNameResolver(board.state.tags);
    return ok(c, {
      total: cards.length,
      items: cards.slice(0, limit).map((card) => slimCard(card, resolveTags)),
      columns: board.columns
        .sort((a, b) => a.order - b.order)
        .map((col) => ({ id: col.id, title: col.title, wipLimit: col.wipLimit, isTerminal: col.isTerminal })),
    });
  } catch (err) {
    console.error("Cards unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.get("/wip", async (c: Context<AuthEnv>) => {
  try {
    const { board, response } = await boardFor(c);
    if (!board) return response!;

    const active = getActiveCards(board.cards, board.columns);
    const counts = new Map<string, number>();
    for (const card of active) counts.set(card.column, (counts.get(card.column) ?? 0) + 1);

    return ok(c, {
      columns: board.columns
        .sort((a, b) => a.order - b.order)
        .map((col) => {
          const count = counts.get(col.id) ?? 0;
          return {
            id: col.id,
            title: col.title,
            count,
            limit: col.wipLimit,
            atLimit: col.wipLimit !== null && col.wipLimit > 0 && count >= col.wipLimit,
            isTerminal: col.isTerminal,
          };
        }),
      activeCount: active.length,
    });
  } catch (err) {
    console.error("WIP unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── GET /api/tokens — list PATs ────────────────────────────────────────────────

app.get("/tokens", async (c: Context<AuthEnv>) => {
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
      return fail(c, 500, "INTERNAL", "Failed to list tokens");
    }

    return ok(c, { tokens: data ?? [] });
  } catch (err) {
    console.error("Token list unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── POST /api/tokens — create PAT ─────────────────────────────────────────────

const ALLOWED_SCOPES = new Set<string>([SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE, SCOPES.BOARD_READ]);

app.post("/tokens", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { name?: unknown; scopes?: unknown };
  try {
    body = (await c.req.json()) as { name?: unknown; scopes?: unknown };
  } catch {
    body = {};
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(c, 400, "VALIDATION", "name is required");
  if (name.length > 100) {
    return fail(c, 400, "VALIDATION", "name must be 100 characters or fewer");
  }

  let scopes: string[];
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes)) {
      return fail(c, 400, "VALIDATION", "scopes must be an array");
    }
    const requested = body.scopes as unknown[];
    for (const s of requested) {
      if (typeof s !== "string" || !ALLOWED_SCOPES.has(s)) {
        return fail(
          c,
          400,
          "VALIDATION",
          `Invalid scope "${String(s)}"`,
          "Allowed: capture:read, capture:write, board:read"
        );
      }
    }
    scopes = requested as string[];
  } else {
    scopes = [SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE, SCOPES.BOARD_READ];
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
      return fail(c, 500, "INTERNAL", "Failed to create token");
    }

    return ok(
      c,
      {
        token: plaintext,
        id: (data as { id: string }).id,
        name: (data as { name: string }).name,
      },
      201
    );
  } catch (err) {
    console.error("Token create unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── DELETE /api/tokens/:id — revoke PAT ────────────────────────────────────────

app.delete("/tokens/:id", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  const id = c.req.param("id");

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
      return fail(c, 500, "INTERNAL", "Failed to revoke token");
    }
    if (!data) return fail(c, 404, "NOT_FOUND", "Token not found");

    return ok(c, { id });
  } catch (err) {
    console.error("Token revoke unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});
