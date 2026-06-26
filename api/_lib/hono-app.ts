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
 *   POST   /api/confirmations        → propose a Tier-3 op (scope: card:write)
 *   POST   /api/confirmations/confirm → claim + execute    (scope: card:write)
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
import { loadFocusSessions, loadMetrics, aggregateFocusSessions } from "./focus-data.js";
import { NOTES_MAX_LENGTH } from "./constants.js";
import { buildTodayPlan, buildTodayDailyPlan, getActiveCards } from "../../src/app/today.js";
import { buildDailyShutdownSummary, buildWeeklyReviewSummary } from "../../src/app/review.js";
import { filterCards, DEFAULT_FILTER } from "../../src/app/filters.js";
import type { Card } from "../../src/app/types.js";
import { createHash, randomBytes } from "crypto";
import { CONFIRMATION_TOOL_ALLOWLIST, executeConfirmedOp } from "./confirm-executor.js";
import { handleMcpRpc } from "./mcp-server.js";
import { runBoardAgent } from "./agent.js";

// ── Allowed origins ────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://focusboard.vercel.app",
  "https://focusboard-alpha.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

/**
 * Account-scoped Vercel deploy suffix. Preview + prod URLs are
 * `focusboard[-<hash>]-claire-donalds-projects.vercel.app`; the
 * `-claire-donalds-projects` segment is Claire's Vercel TEAM slug, which is
 * globally unique and NOT registrable by anyone else — so it's the real trust
 * anchor. The earlier `startsWith("focusboard") && endsWith(".vercel.app")`
 * check admitted any `focusboard-attacker.vercel.app` an attacker could
 * register (OWASP A05, security-review hardening).
 */
const FOCUSBOARD_VERCEL_SUFFIX = "-claire-donalds-projects.vercel.app";

/**
 * Exact allowlist match, or a focusboard deploy under Claire's Vercel team —
 * checked on the parsed HOSTNAME (a substring check admits
 * https://focusboard.vercel.app.evil.com).
 */
export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.startsWith("focusboard") &&
      hostname.endsWith(FOCUSBOARD_VERCEL_SUFFIX)
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
      items: cards.slice(0, limit).map((card) => ({
        ...slimCard(card, resolveTags),
        version: board.versions.get(card.id) ?? null,
      })),
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

// ── Card mutation (Phase 4a, scope card:write) ─────────────────────────────────
//
// External card writes go through the fb_add_card / fb_mutate_card Postgres
// functions: one transaction, app_state row locked, per-card version
// compare-and-swap against the cards mirror. STALE_STATE → 409 (re-read and
// retry); the blob update fires the existing realtime path so an open web tab
// reflects the change live. The web's own writes are untouched in 4a.

function principalUserId(c: Context<AuthEnv>): string {
  return c.get("principal").userId;
}

function mapRpcError(c: Context<AuthEnv>, message: string) {
  if (message.includes("CARD_NOT_FOUND")) {
    return fail(c, 404, "NOT_FOUND", "Card not found", "Use an id from fb list / focusboard_cards");
  }
  if (message.includes("STALE_STATE")) {
    return fail(
      c, 409, "STALE_STATE", "The card changed since you read it",
      "Re-read it (GET /api/cards/:id or fb list) and retry with the fresh version"
    );
  }
  if (message.includes("BOARD_NOT_FOUND")) {
    return fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board");
  }
  console.error("Card mutation rpc error:", message);
  return fail(c, 500, "INTERNAL", "Card mutation failed");
}

/** Map user-facing tag NAMES to the board's internal tag ids. */
function tagIdsFromNames(
  names: unknown,
  tags: { id: string; name: string }[]
): { ids: string[] } | { error: string } {
  if (names === undefined) return { ids: [] };
  if (!Array.isArray(names)) return { error: "tags must be an array of tag names" };
  const byName = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const ids: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") return { error: "tags must be an array of tag names" };
    const id = byName.get(n.toLowerCase());
    if (!id) {
      return { error: `Unknown tag "${n}" — existing tags: ${tags.map((t) => t.name).join(", ") || "(none)"}` };
    }
    ids.push(id);
  }
  return { ids };
}

app.post("/cards", async (c: Context<AuthEnv>) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return fail(c, 400, "VALIDATION", "title is required");
  if (title.length > 300) return fail(c, 400, "VALIDATION", "title must be 300 characters or fewer");

  try {
    const board = await loadBoard(principalUserId(c));
    if (!board) {
      return fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board");
    }

    const column = typeof body.column === "string" && body.column ? body.column : "backlog";
    const col = board.columns.find((cl) => cl.id === column);
    if (!col) {
      return fail(c, 400, "VALIDATION", `Unknown column "${column}"`,
        `Valid columns: ${board.columns.map((cl) => cl.id).join(", ")}`);
    }

    const swimlane = typeof body.swimlane === "string" && body.swimlane ? body.swimlane : "work";
    if (!["work", "personal"].includes(swimlane)) {
      return fail(c, 400, "VALIDATION", `Unknown swimlane "${swimlane}"`, "Use work or personal");
    }

    const tagResult = tagIdsFromNames(body.tags, board.state.tags ?? []);
    if ("error" in tagResult) return fail(c, 400, "VALIDATION", tagResult.error);

    const dueDate = typeof body.dueDate === "string" && body.dueDate ? body.dueDate : undefined;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) {
      return fail(c, 400, "VALIDATION", "dueDate must be an ISO date (YYYY-MM-DD)");
    }

    const now = new Date().toISOString();
    const order = board.cards
      .filter((cd) => cd.column === column && (cd.swimlane ?? "work") === swimlane && !cd.archivedAt)
      .reduce((max, cd) => Math.max(max, cd.order ?? 0), 0) + 1;

    const card: Record<string, unknown> = {
      id: crypto.randomUUID(),
      column,
      swimlane,
      title,
      order,
      ...(typeof body.notes === "string" && body.notes ? { notes: body.notes.slice(0, NOTES_MAX_LENGTH) } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(tagResult.ids.length ? { tags: tagResult.ids } : {}),
      checklist: [],
      createdAt: now,
      updatedAt: now,
      ...(col.isTerminal ? { completedAt: now } : {}),
      columnHistory: [{ from: null, to: column, at: now }],
    };

    const supabase = getServiceClient();
    const { error } = await supabase.rpc("fb_add_card", {
      p_user: principalUserId(c),
      p_card: card,
    });
    if (error) return mapRpcError(c, error.message ?? "");

    const resolveTags = tagNameResolver(board.state.tags);
    return ok(c, { card: { ...slimCard(card as never, resolveTags), version: 1 } }, 201);
  } catch (err) {
    console.error("Card create unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.get("/cards/:id", async (c: Context<AuthEnv>) => {
  const id = c.req.param("id") ?? "";
  try {
    const board = await loadBoard(principalUserId(c));
    if (!board) return fail(c, 404, "NOT_FOUND", "No board found for this user");
    const card = board.cards.find((cd) => cd.id === id);
    if (!card) return fail(c, 404, "NOT_FOUND", "Card not found", "Use an id from fb list / focusboard_cards");
    const resolveTags = tagNameResolver(board.state.tags);
    return ok(c, {
      card: {
        ...slimCard(card, resolveTags),
        archived: Boolean(card.archivedAt),
        version: board.versions.get(card.id) ?? null,
      },
    });
  } catch (err) {
    console.error("Card get unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

type MutateArgs = {
  patch: Record<string, unknown>;
  moveTo?: string | null;
};

async function mutateCard(c: Context<AuthEnv>, id: string, expectedVersion: unknown, args: MutateArgs) {
  // The 409 contract: callers MUST take a position on concurrency. Either pass
  // the version they read (CAS) or an explicit null to deliberately skip the
  // check. Omitting it entirely is an error — that's how silent clobbers happen.
  if (expectedVersion === undefined) {
    return fail(c, 400, "VALIDATION", "version is required (an integer from GET /api/cards/:id)",
      "Pass the version you last read, or version: null to deliberately skip the conflict check");
  }
  if (expectedVersion !== null && (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion))) {
    return fail(c, 400, "VALIDATION", "version must be an integer or null");
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("fb_mutate_card", {
    p_user: principalUserId(c),
    p_card_id: id,
    p_expected_version: expectedVersion,
    p_patch: args.patch,
    p_move_to: args.moveTo ?? null,
  });
  if (error) return mapRpcError(c, error.message ?? "");

  const board = await loadBoard(principalUserId(c));
  const resolveTags = tagNameResolver(board?.state.tags);
  return ok(c, {
    card: {
      ...slimCard(data as never, resolveTags),
      version: board?.versions.get(id) ?? null,
    },
  });
}

app.patch("/cards/:id", async (c: Context<AuthEnv>) => {
  const id = c.req.param("id") ?? "";
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return fail(c, 400, "VALIDATION", "title must be a non-empty string");
      }
      patch.title = body.title.trim().slice(0, 300);
    }
    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== "string") {
        return fail(c, 400, "VALIDATION", "notes must be a string or null");
      }
      patch.notes = body.notes === null ? null : (body.notes as string).slice(0, NOTES_MAX_LENGTH);
    }
    if (body.dueDate !== undefined) {
      if (body.dueDate !== null && (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(body.dueDate))) {
        return fail(c, 400, "VALIDATION", "dueDate must be an ISO date (YYYY-MM-DD) or null");
      }
      patch.dueDate = body.dueDate;
    }
    if (body.blockedReason !== undefined) {
      if (body.blockedReason !== null && typeof body.blockedReason !== "string") {
        return fail(c, 400, "VALIDATION", "blockedReason must be a string or null");
      }
      patch.blockedReason = body.blockedReason === null ? null : (body.blockedReason as string).slice(0, 500);
    }
    if (body.tags !== undefined) {
      const board = await loadBoard(principalUserId(c));
      if (!board) return fail(c, 404, "NOT_FOUND", "No board found for this user");
      const tagResult = tagIdsFromNames(body.tags, board.state.tags ?? []);
      if ("error" in tagResult) return fail(c, 400, "VALIDATION", tagResult.error);
      patch.tags = tagResult.ids;
    }
    if (Object.keys(patch).length === 0) {
      return fail(c, 400, "VALIDATION", "Nothing to update",
        "Provide one of: title, notes, dueDate, tags, blockedReason");
    }

    return await mutateCard(c, id, body.version, { patch });
  } catch (err) {
    console.error("Card patch unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.post("/cards/:id/move", async (c: Context<AuthEnv>) => {
  const id = c.req.param("id") ?? "";
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    const column = typeof body.column === "string" ? body.column : "";
    if (!column) return fail(c, 400, "VALIDATION", "column is required");

    const board = await loadBoard(principalUserId(c));
    if (!board) return fail(c, 404, "NOT_FOUND", "No board found for this user");
    const col = board.columns.find((cl) => cl.id === column);
    if (!col) {
      return fail(c, 400, "VALIDATION", `Unknown column "${column}"`,
        `Valid columns: ${board.columns.map((cl) => cl.id).join(", ")}`);
    }

    const patch: Record<string, unknown> = col.isTerminal
      ? { completedAt: new Date().toISOString() }
      : {};
    return await mutateCard(c, id, body.version, { patch, moveTo: column });
  } catch (err) {
    console.error("Card move unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.post("/cards/:id/done", async (c: Context<AuthEnv>) => {
  const id = c.req.param("id") ?? "";
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    const board = await loadBoard(principalUserId(c));
    if (!board) return fail(c, 404, "NOT_FOUND", "No board found for this user");
    const terminal = board.columns.filter((cl) => cl.isTerminal).sort((a, b) => a.order - b.order)[0];
    if (!terminal) {
      return fail(c, 400, "VALIDATION", "The board has no terminal (done) column");
    }
    return await mutateCard(c, id, body.version, {
      patch: { completedAt: new Date().toISOString() },
      moveTo: terminal.id,
    });
  } catch (err) {
    console.error("Card done unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// Batch move (Phase 5b): up to 20 moves, validated together, executed as
// SEQUENTIAL per-card CAS — deliberately N RPCs over a new batch Postgres
// function (simplicity; reuses the audited fb_mutate_card primitive) and
// deliberately NOT transactional: a board is not an invoice — per-card results
// report partial success honestly instead of punishing 19 good moves for 1
// stale one. Versions are read at EXECUTION time (the board load below), so a
// confirm-gated caller gets fresh CAS at confirm, matching the 4a contract.
const BATCH_MOVE_MAX = 20;

app.post("/cards/batch-move", async (c: Context<AuthEnv>) => {
  let body: { moves?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!Array.isArray(body.moves) || body.moves.length === 0) {
    return fail(c, 400, "VALIDATION", "moves is required (a non-empty array)",
      `Provide 1-${BATCH_MOVE_MAX} moves: [{ id: "...", to: "column-id" }]`);
  }
  if (body.moves.length > BATCH_MOVE_MAX) {
    return fail(c, 400, "VALIDATION", `Too many moves (${body.moves.length})`,
      `Max ${BATCH_MOVE_MAX} per batch — split into multiple calls`);
  }

  const moves: { id: string; to: string }[] = [];
  for (const [i, raw] of body.moves.entries()) {
    const m = raw as { id?: unknown; to?: unknown };
    if (typeof m?.id !== "string" || !m.id.trim() || typeof m?.to !== "string" || !m.to.trim()) {
      return fail(c, 400, "VALIDATION", `moves[${i}] must be { id, to }`);
    }
    moves.push({ id: m.id.trim(), to: m.to.trim() });
  }
  const ids = new Set(moves.map((m) => m.id));
  if (ids.size !== moves.length) {
    return fail(c, 400, "VALIDATION", "Duplicate card ids in the batch",
      "Each card may appear once — merge or drop the duplicates");
  }

  try {
    const board = await loadBoard(principalUserId(c));
    if (!board) {
      return fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board");
    }

    // Validate the WHOLE plan up front — a typo'd column or unknown card fails
    // the batch before anything mutates.
    for (const [i, m] of moves.entries()) {
      const col = board.columns.find((cl) => cl.id === m.to);
      if (!col) {
        return fail(c, 400, "VALIDATION", `moves[${i}]: unknown column "${m.to}"`,
          `Valid columns: ${board.columns.map((cl) => cl.id).join(", ")}`);
      }
      if (!board.cards.some((cd) => cd.id === m.id)) {
        return fail(c, 404, "NOT_FOUND", `moves[${i}]: card "${m.id}" not found`,
          "Use ids from fb list / focusboard_cards");
      }
    }

    const supabase = getServiceClient();
    const results: { id: string; title: string; to: string; ok: boolean; version?: number | null; error?: string }[] = [];

    for (const m of moves) {
      const card = board.cards.find((cd) => cd.id === m.id)!;
      const col = board.columns.find((cl) => cl.id === m.to)!;
      const patch: Record<string, unknown> = col.isTerminal
        ? { completedAt: new Date().toISOString() }
        : {};

      const { data, error } = await supabase.rpc("fb_mutate_card", {
        p_user: principalUserId(c),
        p_card_id: m.id,
        p_expected_version: board.versions.get(m.id) ?? null,
        p_patch: patch,
        p_move_to: m.to,
      });

      if (error) {
        const msg = error.message ?? "";
        const code = msg.includes("STALE_STATE") ? "STALE_STATE"
          : msg.includes("CARD_NOT_FOUND") ? "NOT_FOUND"
          : "INTERNAL";
        if (code === "INTERNAL") console.error(`Batch move "${m.id}" rpc error:`, msg);
        results.push({ id: m.id, title: card.title, to: m.to, ok: false, error: code });
        continue;
      }
      void data;
      const prev = board.versions.get(m.id);
      results.push({
        id: m.id, title: card.title, to: m.to, ok: true,
        version: typeof prev === "number" ? prev + 1 : null,
      });
    }

    return ok(c, {
      total: moves.length,
      moved: results.filter((r) => r.ok).length,
      results,
    });
  } catch (err) {
    console.error("Batch move unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── Focus sessions (Phase 3, scopes focus:read / focus:write) ─────────────────
//
// Append-only rows in focus_sessions — never blob mutation. One active session
// per user is enforced by a partial unique index, so a concurrent double-start
// loses at the database, not in application code.

const FOCUS_OUTCOMES = ["progressed", "blocked", "completed", "abandoned"] as const;

app.get("/focus/status", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  try {
    const supabase = getServiceClient();

    const { data: active, error } = await supabase
      .from("focus_sessions")
      .select("id, card_id, card_title, planned_minutes, started_at, source")
      .eq("user_id", principal.userId)
      .is("ended_at", null)
      .maybeSingle();

    if (error) {
      console.error("Focus status error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to read focus status");
    }

    // Today's closed sessions (UTC day) for the status summary.
    const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const { data: todays } = await supabase
      .from("focus_sessions")
      .select("planned_minutes, started_at, ended_at, outcome")
      .eq("user_id", principal.userId)
      .not("ended_at", "is", null)
      .gte("started_at", dayStart);

    const sessions = todays ?? [];
    const focusedMinutes = sessions.reduce((sum, s) => {
      const ms = new Date(s.ended_at as string).getTime() - new Date(s.started_at as string).getTime();
      return sum + Math.max(0, Math.round(ms / 60_000));
    }, 0);

    return ok(c, {
      active: active
        ? {
            id: active.id,
            cardId: active.card_id,
            cardTitle: active.card_title,
            plannedMinutes: active.planned_minutes,
            startedAt: active.started_at,
            source: active.source,
          }
        : null,
      today: { sessions: sessions.length, focusedMinutes },
    });
  } catch (err) {
    console.error("Focus status unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.post("/focus/start", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { cardId?: unknown; plannedMinutes?: unknown; source?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  const plannedMinutes = Math.max(1, Math.min(480, Number(body.plannedMinutes) || 25));
  const cardId = typeof body.cardId === "string" && body.cardId.trim() ? body.cardId.trim() : null;

  try {
    const supabase = getServiceClient();

    // Denormalise the card title at start time (the board may change later).
    let cardTitle: string | null = null;
    if (cardId) {
      const board = await loadBoard(principal.userId);
      const card = board?.cards.find((cd) => cd.id === cardId && !cd.archivedAt);
      if (!card) {
        return fail(c, 404, "NOT_FOUND", `Card "${cardId}" not found on the board`, "Use an id from fb list / focusboard_cards");
      }
      cardTitle = card.title;
    }

    const { data, error } = await supabase
      .from("focus_sessions")
      .insert({
        user_id: principal.userId,
        card_id: cardId,
        card_title: cardTitle,
        planned_minutes: plannedMinutes,
        source: principal.kind === "pat" ? "cli" : "web",
      })
      .select("id, started_at")
      .single();

    if (error) {
      // 23505 = the partial unique index: a session is already running.
      if (error.code === "23505") {
        return fail(
          c, 409, "ALREADY_ACTIVE", "A focus session is already running",
          "Stop it first (fb focus stop) or check fb focus status"
        );
      }
      console.error("Focus start error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to start focus session");
    }

    return ok(c, {
      id: (data as { id: string }).id,
      cardId,
      cardTitle,
      plannedMinutes,
      startedAt: (data as { started_at: string }).started_at,
    });
  } catch (err) {
    console.error("Focus start unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.post("/focus/stop", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { outcome?: unknown; note?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  const outcome = typeof body.outcome === "string" ? body.outcome : "progressed";
  if (!(FOCUS_OUTCOMES as readonly string[]).includes(outcome)) {
    return fail(
      c, 400, "VALIDATION", `Invalid outcome "${outcome}"`,
      `Allowed: ${FOCUS_OUTCOMES.join(", ")}`
    );
  }
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("focus_sessions")
      .update({ ended_at: new Date().toISOString(), outcome, note })
      .eq("user_id", principal.userId)
      .is("ended_at", null)
      .select("id, card_id, card_title, planned_minutes, started_at, ended_at, outcome")
      .maybeSingle();

    if (error) {
      console.error("Focus stop error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to stop focus session");
    }
    if (!data) {
      return fail(c, 404, "NOT_FOUND", "No active focus session", "Start one with fb focus start");
    }

    const row = data as {
      id: string; card_id: string | null; card_title: string | null;
      planned_minutes: number; started_at: string; ended_at: string; outcome: string;
    };
    const actualMinutes = Math.max(
      0,
      Math.round((new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60_000)
    );

    return ok(c, {
      id: row.id,
      cardId: row.card_id,
      cardTitle: row.card_title,
      plannedMinutes: row.planned_minutes,
      actualMinutes,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      outcome: row.outcome,
    });
  } catch (err) {
    console.error("Focus stop unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── Phase 5a: focus history + review digests + batch capture ──────────────────
//
// Composite READS are server-side (one endpoint, importing the web's own
// review.ts semantics — the no-drift rule); focus sessions come from the
// focus_sessions TABLE (system of record), the metrics blob only contributes
// completedCards/reviewMarkers. Digests expose focus data as AGGREGATES ONLY:
// raw session rows stay exclusively behind focus:read (/api/focus/*) — a
// board:read token must not read focus history through the digest.

app.get("/focus/history", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  const daysRaw = Number(c.req.query("days") ?? 7);
  const days = Math.max(1, Math.min(90, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 7));

  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const sessions = await loadFocusSessions(principal.userId, since);

    const byDay: Record<string, { sessionCount: number; minutes: number }> = {};
    for (const s of sessions) {
      const day = s.endedAt.slice(0, 10);
      const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
      const entry = (byDay[day] ??= { sessionCount: 0, minutes: 0 });
      entry.sessionCount += 1;
      entry.minutes += Math.max(0, Math.round(ms / 60_000));
    }

    return ok(c, {
      days,
      ...aggregateFocusSessions(sessions),
      byDay,
      sessions: sessions.map((s) => ({
        id: s.id,
        cardId: s.cardId || null,
        cardTitle: s.cardTitle,
        plannedMinutes: s.plannedMinutes,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        outcome: s.outcome,
        ...(s.note ? { note: s.note } : {}),
      })),
    });
  } catch (err) {
    console.error("Focus history unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

/** Slim + version projection for digest card lists. */
function digestCards(
  cards: Card[],
  board: NonNullable<Awaited<ReturnType<typeof loadBoard>>>,
  resolveTags: (ids?: string[]) => string[]
) {
  return cards.map((card) => ({
    ...slimCard(card, resolveTags),
    version: board.versions.get(card.id) ?? null,
  }));
}

app.get("/review/daily", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  try {
    const board = await loadBoard(principal.userId);
    if (!board) {
      return fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board");
    }
    // 2 days of table sessions comfortably covers "today" (the builder filters
    // precisely by date key); metrics blob contributes completedCards/markers.
    const [metrics, sessions] = await Promise.all([
      loadMetrics(principal.userId),
      loadFocusSessions(principal.userId, new Date(Date.now() - 2 * 86_400_000)),
    ]);

    const summary = buildDailyShutdownSummary(board.cards, board.columns, {
      ...metrics,
      focusSessions: sessions,
    });

    const resolveTags = tagNameResolver(board.state.tags);
    return ok(c, {
      date: summary.date,
      isComplete: summary.isComplete,
      completedToday: summary.completedToday,
      focus: aggregateFocusSessions(summary.focusSessionsToday),
      slipped: digestCards(summary.slippedCards, board, resolveTags),
      blocked: digestCards(summary.blockedCards, board, resolveTags),
      stale: digestCards(summary.staleCards, board, resolveTags),
      tomorrowCandidates: digestCards(summary.tomorrowCandidates, board, resolveTags),
    });
  } catch (err) {
    console.error("Daily review unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

app.get("/review/weekly", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  try {
    const board = await loadBoard(principal.userId);
    if (!board) {
      return fail(c, 404, "NOT_FOUND", "No board found for this user", "Open the web app once to create your board");
    }
    const [metrics, sessions] = await Promise.all([
      loadMetrics(principal.userId),
      loadFocusSessions(principal.userId, new Date(Date.now() - 8 * 86_400_000)),
    ]);

    const summary = buildWeeklyReviewSummary(board.cards, board.columns, {
      ...metrics,
      focusSessions: sessions,
    });

    const resolveTags = tagNameResolver(board.state.tags);
    return ok(c, {
      weekKey: summary.weekKey,
      isComplete: summary.isComplete,
      completedThisWeek: summary.completedThisWeek,
      focus: aggregateFocusSessions(summary.focusSessionsThisWeek),
      blocked: digestCards(summary.blockedCards, board, resolveTags),
      staleBacklog: digestCards(summary.staleBacklog, board, resolveTags),
      proposedCommitments: digestCards(summary.proposedCommitments, board, resolveTags),
    });
  } catch (err) {
    console.error("Weekly review unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// Batch capture — a SEPARATE route from POST /api/capture (the INLINE_AUTH
// exception with hand-rolled webhook-body auth); this one gets normal
// route→scope enforcement. The agent does the language work (splitting
// meeting notes); the server takes ready items. No AI processing is
// triggered — PAT captures keep auto-add disabled, batches doubly so.
const BATCH_MAX_ITEMS = 25;

app.post("/capture/batch", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  let body: { items?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return fail(c, 400, "VALIDATION", "items is required (a non-empty array)",
      `Provide 1-${BATCH_MAX_ITEMS} items: [{ content: "..." }]`);
  }
  if (body.items.length > BATCH_MAX_ITEMS) {
    return fail(c, 400, "VALIDATION", `Too many items (${body.items.length})`,
      `Max ${BATCH_MAX_ITEMS} per batch — split into multiple calls`);
  }

  const items: { content: string; source: string }[] = [];
  for (const [i, raw] of body.items.entries()) {
    const item = raw as { content?: unknown; source?: unknown };
    if (typeof item?.content !== "string" || !item.content.trim()) {
      return fail(c, 400, "VALIDATION", `items[${i}].content is required (non-empty string)`);
    }
    const validSources = ["email", "slack", "shortcut", "browser", "whatsapp", "in_app"];
    items.push({
      content: item.content.trim().substring(0, 10000),
      source: validSources.includes(item.source as string) ? (item.source as string) : "in_app",
    });
  }

  try {
    const supabase = getServiceClient();

    // Rate limit: the batch counts as items.length against the per-user
    // window. `count + items > MAX` enforces the SAME ≤MAX-rows-per-window cap
    // as the single route's `count >= MAX` pre-insert check (a full 30-batch
    // from a cold window is legal; a 31st row never is). Best-effort (the
    // count isn't reserved; a concurrent capture can race it) — acceptable
    // single-user, revisit with a DB counter if needed.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
    const { count } = await supabase
      .from("capture_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", principal.userId)
      .gte("created_at", windowStart);
    if ((count ?? 0) + items.length > RATE_LIMIT_MAX) {
      return fail(c, 429, "RATE_LIMITED",
        `Batch of ${items.length} would exceed the rate limit (${count ?? 0}/${RATE_LIMIT_MAX} used)`,
        "Retry in 60 seconds");
    }

    // Per-item idempotency: batch key K → item key sha256(K + ":" + index).
    // (Delimited — "ab"+"1" and "a"+"b1" must not collide.) The unique index
    // is partial (WHERE idempotency_key IS NOT NULL), which ON CONFLICT can't
    // target through supabase-js — so: batched pre-check + per-item insert
    // with 23505 recovery, the same proven pattern as the single route.
    // The header is OPTIONAL: omit it and you get no dedup — a bare retry
    // inserts duplicates (the CLI/MCP clients always send one).
    const batchKey = c.req.header("idempotency-key");
    const itemKeys = batchKey
      ? items.map((_, i) => createHash("sha256").update(`${batchKey}:${i}`).digest("hex"))
      : null;

    const existingByKey = new Map<string, string>();
    if (itemKeys) {
      const { data: existing } = await supabase
        .from("capture_queue")
        .select("id, idempotency_key")
        .eq("user_id", principal.userId)
        .in("idempotency_key", itemKeys);
      for (const row of (existing ?? []) as { id: string; idempotency_key: string }[]) {
        existingByKey.set(row.idempotency_key, row.id);
      }
    }

    const results: { index: number; ok: boolean; captureId?: string; duplicate?: boolean; error?: string }[] = [];
    for (const [i, item] of items.entries()) {
      const key = itemKeys?.[i];
      const dupId = key ? existingByKey.get(key) : undefined;
      if (dupId) {
        results.push({ index: i, ok: true, captureId: dupId, duplicate: true });
        continue;
      }
      const { data, error } = await supabase
        .from("capture_queue")
        .insert({
          user_id: principal.userId,
          status: "pending",
          source: item.source,
          raw_content: item.content,
          raw_metadata: {},
          ...(key ? { idempotency_key: key } : {}),
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505" && key) {
          const { data: raced } = await supabase
            .from("capture_queue")
            .select("id")
            .eq("user_id", principal.userId)
            .eq("idempotency_key", key)
            .maybeSingle();
          const racedId = (raced as { id: string } | null)?.id;
          // A duplicate with no recoverable id is a failure, not a success —
          // an ok:true result must always carry a usable captureId.
          results.push(
            racedId
              ? { index: i, ok: true, captureId: racedId, duplicate: true }
              : { index: i, ok: false, error: "INSERT_FAILED" }
          );
          continue;
        }
        console.error(`Batch capture item ${i} insert error:`, error.message);
        results.push({ index: i, ok: false, error: "INSERT_FAILED" });
        continue;
      }
      results.push({ index: i, ok: true, captureId: (data as { id: string }).id });
    }

    const landed = results.filter((r) => r.ok).length;
    if (landed === 0) {
      return fail(c, 500, "INTERNAL", "No items in the batch could be captured");
    }
    return ok(c, { total: items.length, captured: landed, results }, 201);
  } catch (err) {
    console.error("Batch capture unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── Phase 6.1: durable MCP confirmation gate ──────────────────────────────────
//
// These two routes replace the stdio process's in-memory Map for Tier-3 tool
// confirmations. The gate is now durable: a stateless hosted MCP server can
// use the same routes.
//
// SECURITY INVARIANTS (enforced atomically in the DB update):
//   - user_id equality: cross-principal tokens can never execute.
//   - single-use: enforced by the row update (SET used_at = now() WHERE used_at IS NULL).
//   - expiry: enforced by expires_at > now() in the WHERE clause.
//   - allowlist: only known tools can be proposed; unknown tools are rejected at
//     proposal time, before a token row is ever created.

const CONFIRM_TTL_SECONDS = 300; // 5 minutes

/** sha256 hex of a token string (matches the migration's storage model). */
function hashConfirmToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// POST /api/confirmations — propose a Tier-3 operation.
// Body: { tool, args, preview }
// Returns: { confirm_token, expires_in_seconds, preview }
app.post("/confirmations", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");

  let body: { tool?: unknown; args?: unknown; preview?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  const tool = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!tool) return fail(c, 400, "VALIDATION", "tool is required");
  if (!CONFIRMATION_TOOL_ALLOWLIST.has(tool)) {
    return fail(
      c, 400, "VALIDATION",
      `Unknown tool "${tool}"`,
      `Allowed tools: ${[...CONFIRMATION_TOOL_ALLOWLIST].join(", ")}`
    );
  }

  const preview = typeof body.preview === "string" ? body.preview.trim() : "";
  if (!preview) return fail(c, 400, "VALIDATION", "preview is required (non-empty string)");
  if (preview.length > 2000) {
    return fail(c, 400, "VALIDATION", "preview must be 2000 characters or fewer");
  }

  if (!body.args || typeof body.args !== "object" || Array.isArray(body.args)) {
    return fail(c, 400, "VALIDATION", "args is required (an object)");
  }

  // Mint a random token; store only its sha256 hash.
  const plaintext = randomBytes(32).toString("base64url");
  const tokenHash = hashConfirmToken(plaintext);
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_SECONDS * 1000).toISOString();

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.from("mcp_confirmations").insert({
      user_id: principal.userId,
      token_hash: tokenHash,
      tool,
      args: body.args,
      preview,
      expires_at: expiresAt,
    });
    if (error) {
      console.error("Confirmation create error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to create confirmation");
    }
    return ok(c, { confirm_token: plaintext, expires_in_seconds: CONFIRM_TTL_SECONDS, preview }, 201);
  } catch (err) {
    console.error("Confirmation create unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// POST /api/confirmations/confirm — claim and execute.
// Body: { confirm_token }
// Returns: the executor's response body verbatim under the normal envelope.
app.post("/confirmations/confirm", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");

  let body: { confirm_token?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  const confirmToken = typeof body.confirm_token === "string" ? body.confirm_token.trim() : "";
  if (!confirmToken) return fail(c, 400, "VALIDATION", "confirm_token is required");

  const tokenHash = hashConfirmToken(confirmToken);
  const now = new Date().toISOString();

  try {
    const supabase = getServiceClient();

    // Atomic claim: SET used_at = now() WHERE token_hash = hash AND used_at IS NULL
    // AND expires_at > now() AND user_id = principal.userId.
    // Zero rows → the token is unknown, expired, already used, or belongs to another user.
    const { data, error } = await supabase
      .from("mcp_confirmations")
      .update({ used_at: now })
      .eq("token_hash", tokenHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .eq("user_id", principal.userId)
      .select("tool, args")
      .maybeSingle();

    if (error) {
      console.error("Confirmation claim error:", error.message);
      return fail(c, 500, "INTERNAL", "Failed to claim confirmation");
    }
    if (!data) {
      return fail(
        c, 404, "CONFIRM_NOT_FOUND",
        "Confirmation token not found or already used",
        "expired, already used, or not yours — re-propose the operation"
      );
    }

    const { tool, args } = data as { tool: string; args: Record<string, unknown> };
    const authHeader = c.req.header("authorization") ?? "";

    // Execute the mapped operation in-process. The executor lazily references app,
    // which is fully constructed before any request can arrive.
    try {
      const result = await executeConfirmedOp(app, tool, args, authHeader);
      return ok(c, result as Record<string, unknown>);
    } catch (execErr) {
      // Surface the underlying route's error (e.g. 409 STALE_STATE, 404 NOT_FOUND).
      const e = execErr as { code?: string; message?: string; hint?: string; status?: number };
      const status = (e.status ?? 500) as 400 | 404 | 409 | 500;
      const code = (e.code ?? "INTERNAL") as Parameters<typeof fail>[2];
      return fail(c, status, code, e.message ?? "Execution failed", e.hint);
    }
  } catch (err) {
    console.error("Confirmation confirm unexpected error:", err);
    return fail(c, 500, "INTERNAL", "Internal server error");
  }
});

// ── POST /api/ai/agent — natural-language board command agent ──────────────────
// A hand-rolled Anthropic tool-use loop: Claude calls board tools, we execute
// them immediately in-process, feed results back, and loop until it's done.
app.post("/ai/agent", async (c: Context<AuthEnv>) => {
  const principal = c.get("principal");
  const authHeader = c.req.header("authorization") ?? "";

  let body: { instruction?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) return fail(c, 400, "VALIDATION", "instruction is required");
  if (instruction.length > 1000) {
    return fail(c, 400, "VALIDATION", "instruction too long (max 1000 characters)");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(c, 500, "INTERNAL", "ANTHROPIC_API_KEY not configured");
  }

  try {
    const result = await runBoardAgent({ app, authHeader, userId: principal.userId, instruction });
    return ok(c, result);
  } catch (err) {
    console.error("Board agent error:", err);
    const e = err as { status?: number; code?: string; message?: string; hint?: string };
    const status = (e.status ?? 500) as 400 | 404 | 409 | 500;
    const code = (e.code ?? "INTERNAL") as Parameters<typeof fail>[2];
    return fail(c, status, code, e.message ?? "Agent failed", e.hint);
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

const ALLOWED_SCOPES = new Set<string>([SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE, SCOPES.BOARD_READ, SCOPES.FOCUS_READ, SCOPES.FOCUS_WRITE, SCOPES.CARD_WRITE]);

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
          "Allowed: capture:read, capture:write, board:read, focus:read, focus:write, card:write"
        );
      }
    }
    scopes = requested as string[];
  } else {
    scopes = [SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE, SCOPES.BOARD_READ, SCOPES.FOCUS_READ, SCOPES.FOCUS_WRITE, SCOPES.CARD_WRITE];
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
  const id = c.req.param("id") ?? "";

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

// ── Phase 6.2: OAuth 2.1 stub (single-principal) ──────────────────────────────
//
// NOTE: OAuth/DCR endpoints return RAW RFC-shaped JSON bodies — NOT the
// { ok, data } / { ok, error } envelope used by every other route here.
// claude.ai and OAuth clients expect RFC 6749 / RFC 7591 shapes. Comments
// on each handler note the specific RFC response format.
//
// All OAuth routes are PUBLIC in ROUTE_SCOPES (the flow authenticates via
// Supabase password, not Bearer tokens). The authorize page verifies Claire's
// credentials server-side via Supabase auth.signInWithPassword.

const OAUTH_SCOPES_SUPPORTED = [
  "capture:read", "capture:write", "board:read", "focus:read", "focus:write", "card:write",
];
const OAUTH_CODE_TTL_SECONDS = 300; // 5 minutes
// Per-IP credential-form throttle (defense in depth over Supabase Auth's limit).
// Generous enough never to trip a real human; tight enough to stop a script.
const OAUTH_LOGIN_WINDOW_SECONDS = 600; // 10 minutes
const OAUTH_LOGIN_MAX_ATTEMPTS = 15;

/** sha256 hex of a string. */
function hashOAuth(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
// Body: { redirect_uris: string[], client_name?: string }
// Returns RFC 7591 client metadata (NOT the ok/data envelope).
app.post("/oauth/register", async (c: Context<AuthEnv>) => {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  // Validate redirect_uris: non-empty array of https:// URLs (or http://localhost).
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return c.json({ error: "invalid_client_metadata", error_description: "redirect_uris must be a non-empty array" }, 400);
  }
  const redirectUris = body.redirect_uris as unknown[];
  for (const uri of redirectUris) {
    if (typeof uri !== "string") {
      return c.json({ error: "invalid_client_metadata", error_description: "Each redirect_uri must be a string" }, 400);
    }
    try {
      const parsed = new URL(uri);
      const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
        return c.json({ error: "invalid_client_metadata", error_description: `redirect_uri must use https:// (or http://localhost): ${uri}` }, 400);
      }
    } catch {
      return c.json({ error: "invalid_client_metadata", error_description: `Invalid redirect_uri: ${uri}` }, 400);
    }
  }

  const clientName = typeof body.client_name === "string" ? body.client_name.trim() : null;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("oauth_clients")
      .insert({ redirect_uris: redirectUris, client_name: clientName })
      .select("client_id, client_name, redirect_uris")
      .single();

    if (error) {
      console.error("OAuth register error:", error.message);
      return c.json({ error: "server_error", error_description: "Failed to register client" }, 500);
    }

    // RFC 7591 response shape.
    return c.json({
      client_id: (data as { client_id: string }).client_id,
      client_name: (data as { client_name: string | null }).client_name,
      redirect_uris: (data as { redirect_uris: string[] }).redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, 201);
  } catch (err) {
    console.error("OAuth register unexpected error:", err);
    return c.json({ error: "server_error", error_description: "Internal server error" }, 500);
  }
});

// GET /api/oauth/authorize — render the login page.
// Query: response_type=code, client_id, redirect_uri, state?, code_challenge, code_challenge_method=S256, scope?
// On invalid client/redirect_uri → 400 text (do NOT redirect).
// On other param errors → redirect with ?error=invalid_request.
app.get("/oauth/authorize", async (c: Context<AuthEnv>) => {
  const clientId = c.req.query("client_id") ?? "";
  const redirectUri = c.req.query("redirect_uri") ?? "";
  const responseType = c.req.query("response_type") ?? "";
  const state = c.req.query("state") ?? "";
  const codeChallenge = c.req.query("code_challenge") ?? "";
  const codeChallengeMethod = c.req.query("code_challenge_method") ?? "";
  const scope = c.req.query("scope") ?? OAUTH_SCOPES_SUPPORTED.join(" ");

  // Validate client + redirect_uri first (do NOT redirect on these errors per RFC 6749 §4.1.2.1).
  if (!clientId) return c.text("Missing client_id", 400);
  if (!redirectUri) return c.text("Missing redirect_uri", 400);

  const supabase = getServiceClient();
  const { data: client } = await supabase
    .from("oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!client) return c.text("Unknown client_id", 400);

  const registeredUris = (client as { redirect_uris: string[] }).redirect_uris;
  if (!registeredUris.includes(redirectUri)) {
    return c.text("redirect_uri not registered for this client", 400);
  }

  // From here on, errors redirect with ?error=...
  const errorRedirect = (error: string, description?: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  };

  if (responseType !== "code") return errorRedirect("unsupported_response_type");
  if (!codeChallenge) return errorRedirect("invalid_request", "code_challenge is required");
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    return errorRedirect("invalid_request", "Only S256 code_challenge_method is supported");
  }

  // Render the login form. All params are passed as hidden fields so the POST handler
  // can re-validate them without relying on session state.
  const html = buildAuthorizeHtml({
    clientId,
    redirectUri,
    state,
    codeChallenge,
    scope,
    error: null,
  });

  // NB: NO `form-action` directive. CSP form-action governs the ENTIRE
  // navigation a form submission triggers — including the server's 302 to the
  // OAuth redirect_uri (claude.ai). `form-action 'self'` blocked that redirect,
  // so the browser refused to submit the login at all ("violates form-action
  // 'self'"). The form's action is statically our own endpoint (no XSS to
  // repoint it) and the post-login redirect is validated server-side against
  // the registered redirect_uri — that allow-list is the real control.
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  c.header("Cache-Control", "no-store");
  return c.html(html, 200);
});

// POST /api/oauth/authorize — process the login form.
// Body: form-urlencoded (application/x-www-form-urlencoded).
// On bad credentials → re-render the form with an error.
// On success → 302 to redirect_uri?code=...&state=...
app.post("/oauth/authorize", async (c: Context<AuthEnv>) => {
  const body = await c.req.parseBody();

  const clientId = (body.client_id as string) ?? "";
  const redirectUri = (body.redirect_uri as string) ?? "";
  const state = (body.state as string) ?? "";
  const codeChallenge = (body.code_challenge as string) ?? "";
  const scope = (body.scope as string) ?? OAUTH_SCOPES_SUPPORTED.join(" ");
  const email = (body.email as string) ?? "";
  const password = (body.password as string) ?? "";

  // Re-validate client + redirect_uri (the form could be tampered).
  if (!clientId || !redirectUri) return c.text("Invalid request", 400);

  const supabase = getServiceClient();
  const { data: client } = await supabase
    .from("oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!client) return c.text("Unknown client_id", 400);
  const registeredUris = (client as { redirect_uris: string[] }).redirect_uris;
  if (!registeredUris.includes(redirectUri)) {
    return c.text("redirect_uri not registered for this client", 400);
  }

  // Per-IP throttle (defense in depth over Supabase Auth's own sign-in limit).
  // Count this IP's attempts in the window; refuse past the threshold. Record
  // the attempt regardless of outcome (a brute-forcer's failures all count).
  const ip = (c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown")
    .split(",")[0]!.trim();
  const windowStart = new Date(Date.now() - OAUTH_LOGIN_WINDOW_SECONDS * 1000).toISOString();
  const { count: attemptCount } = await supabase
    .from("oauth_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("attempted_at", windowStart);
  if ((attemptCount ?? 0) >= OAUTH_LOGIN_MAX_ATTEMPTS) {
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", String(OAUTH_LOGIN_WINDOW_SECONDS));
    return c.html(buildAuthorizeHtml({ clientId, redirectUri, state, codeChallenge, scope, error: "Too many sign-in attempts — please wait a few minutes and try again" }), 429);
  }
  // Fire-and-forget record (never block the login on the throttle's own write).
  void supabase.from("oauth_login_attempts").insert({ ip });

  // Verify credentials server-side via Supabase anon key (throwaway client).
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error("OAuth authorize: SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) is not set");
    return c.html(buildAuthorizeHtml({ clientId, redirectUri, state, codeChallenge, scope, error: "Server configuration error" }), 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password });

  if (authError || !authData.user) {
    // Bad credentials → re-render form with error (HTTP 200 per OAuth convention for login forms).
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    return c.html(buildAuthorizeHtml({ clientId, redirectUri, state, codeChallenge, scope, error: "Invalid email or password" }), 200);
  }

  const userId = authData.user.id;

  // Mint a single-use authorization code (store sha256 hash; return plaintext).
  const codeRaw = randomBytes(32).toString("base64url");
  const codeHash = hashOAuth(codeRaw);
  const effectiveScope = scope || OAUTH_SCOPES_SUPPORTED.join(" ");
  const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1000).toISOString();

  const { error: insertError } = await supabase.from("oauth_codes").insert({
    code_hash: codeHash,
    client_id: clientId,
    user_id: userId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    scope: effectiveScope,
    expires_at: expiresAt,
  });

  if (insertError) {
    console.error("OAuth code insert error:", insertError.message);
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    c.header("Cache-Control", "no-store");
    return c.html(buildAuthorizeHtml({ clientId, redirectUri, state, codeChallenge, scope, error: "Server error — please try again" }), 500);
  }

  // Redirect to redirect_uri with code (and state if present).
  const dest = new URL(redirectUri);
  dest.searchParams.set("code", codeRaw);
  if (state) dest.searchParams.set("state", state);
  return c.redirect(dest.toString(), 302);
});

// POST /api/oauth/token — exchange code for tokens, or rotate a refresh token.
// Accepts application/x-www-form-urlencoded OR application/json.
// Returns RFC 6749 token response (NOT the ok/data envelope).
app.post("/oauth/token", async (c: Context<AuthEnv>) => {
  // Parse body from form or JSON.
  let fields: Record<string, string>;
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const parsed = await c.req.parseBody();
    fields = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)])
    );
  } else {
    try {
      fields = (await c.req.json()) as Record<string, string>;
    } catch {
      return c.json({ error: "invalid_request", error_description: "Could not parse request body" }, 400);
    }
  }

  const grantType = fields.grant_type ?? "";
  const supabase = getServiceClient();

  // ── authorization_code grant ───────────────────────────────────────────────
  if (grantType === "authorization_code") {
    const code = fields.code ?? "";
    const redirectUri = fields.redirect_uri ?? "";
    const codeVerifier = fields.code_verifier ?? "";
    const clientId = fields.client_id ?? "";

    if (!code || !redirectUri || !codeVerifier) {
      return c.json({ error: "invalid_request", error_description: "code, redirect_uri, and code_verifier are required" }, 400);
    }

    const codeHash = hashOAuth(code);
    const now = new Date().toISOString();

    // Atomic claim: UPDATE used_at WHERE code_hash AND used_at IS NULL AND expires_at > now RETURNING.
    const { data: codeRow, error: claimError } = await supabase
      .from("oauth_codes")
      .update({ used_at: now })
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("client_id, user_id, redirect_uri, code_challenge, scope")
      .maybeSingle();

    if (claimError) {
      console.error("OAuth token code claim error:", claimError.message);
      return c.json({ error: "server_error" }, 500);
    }
    if (!codeRow) {
      return c.json({ error: "invalid_grant", error_description: "Code not found, expired, or already used" }, 400);
    }

    const row = codeRow as { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string };

    // Verify client_id (when supplied) and redirect_uri match the stored row.
    // Deliberate: PKCE (verified below) is the binding that stops a stolen-code
    // replay — only the holder of the code_verifier can redeem, regardless of
    // client_id. The client_id match is defense-in-depth, enforced WHEN the
    // request presents one; it is not required, because a public connector may
    // omit it at the token endpoint and forcing it would break the flow with no
    // security gain over PKCE (review finding A, accepted for single-principal).
    if (clientId && row.client_id !== clientId) {
      return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
    }
    if (row.redirect_uri !== redirectUri) {
      return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }

    // Verify PKCE: base64url(sha256(code_verifier)) must equal the stored code_challenge.
    const expectedChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (expectedChallenge !== row.code_challenge) {
      return c.json({ error: "invalid_grant", error_description: "code_verifier does not match code_challenge" }, 400);
    }

    // Mint tokens.
    const { accessToken, refreshToken, accessHash, refreshHash, accessExpiresAt } = mintTokenPair();

    const { error: insertError } = await supabase.from("oauth_tokens").insert({
      client_id: row.client_id,
      user_id: row.user_id,
      access_token_hash: accessHash,
      refresh_token_hash: refreshHash,
      scope: row.scope,
      access_expires_at: accessExpiresAt,
    });

    if (insertError) {
      console.error("OAuth token insert error:", insertError.message);
      return c.json({ error: "server_error" }, 500);
    }

    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: row.scope,
    }, 200);
  }

  // ── refresh_token grant ────────────────────────────────────────────────────
  if (grantType === "refresh_token") {
    const refreshToken = fields.refresh_token ?? "";
    if (!refreshToken) {
      return c.json({ error: "invalid_request", error_description: "refresh_token is required" }, 400);
    }

    const refreshHash = hashOAuth(refreshToken);
    const nowIso = new Date().toISOString();
    const { data: existingRow, error: lookupError } = await supabase
      .from("oauth_tokens")
      .select("id, client_id, user_id, scope")
      .eq("refresh_token_hash", refreshHash)
      .is("revoked_at", null)
      .gt("refresh_expires_at", nowIso) // expired refresh tokens are dead (review finding D)
      .maybeSingle();

    if (lookupError) {
      console.error("OAuth refresh lookup error:", lookupError.message);
      return c.json({ error: "server_error" }, 500);
    }
    if (!existingRow) {
      return c.json({ error: "invalid_grant", error_description: "refresh_token not found, revoked, or expired" }, 400);
    }

    const existing = existingRow as { id: string; client_id: string; user_id: string; scope: string };

    // Rotate INSERT-FIRST, then revoke (review finding B): if the function dies
    // between the two writes, the worst case is the old refresh token briefly
    // still works (a benign double-valid for the SAME single principal) — never
    // a lockout, never a second principal. Revoke-first risked permanent
    // lockout on a mid-rotation crash.
    const { accessToken, refreshToken: newRefreshToken, accessHash, refreshHash: newRefreshHash, accessExpiresAt } = mintTokenPair();

    const { error: insertError } = await supabase.from("oauth_tokens").insert({
      client_id: existing.client_id,
      user_id: existing.user_id,
      access_token_hash: accessHash,
      refresh_token_hash: newRefreshHash,
      scope: existing.scope,
      access_expires_at: accessExpiresAt,
    });

    if (insertError) {
      console.error("OAuth refresh insert error:", insertError.message);
      return c.json({ error: "server_error" }, 500);
    }

    const { error: revokeError } = await supabase
      .from("oauth_tokens")
      .update({ revoked_at: nowIso })
      .eq("id", existing.id);

    if (revokeError) {
      // The new pair is already live; a lingering old token is benign (same
      // principal) and expires on its own. Log, don't fail the grant.
      console.error("OAuth refresh revoke (post-insert) error — old token left to expire:", revokeError.message);
    }

    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: existing.scope,
    }, 200);
  }

  // ── unsupported grant ──────────────────────────────────────────────────────
  return c.json({ error: "unsupported_grant_type" }, 400);
});

/** Mint a new access + refresh token pair. Returns plaintexts and hashes. */
function mintTokenPair() {
  const accessToken = "fb_oat_" + randomBytes(32).toString("base64url");
  const refreshToken = "fb_ort_" + randomBytes(32).toString("base64url");
  const accessHash = hashOAuth(accessToken);
  const refreshHash = hashOAuth(refreshToken);
  const accessExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  return { accessToken, refreshToken, accessHash, refreshHash, accessExpiresAt };
}

/** Build the OAuth authorization HTML page. */
function buildAuthorizeHtml(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  error: string | null;
}): string {
  const { clientId, redirectUri, state, codeChallenge, scope, error } = params;
  const escAttr = (s: string) => s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const errorHtml = error
    ? `<p class="error">${escHtml(error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FocusBoard — Sign in</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f0f10;
    color: #e2e2e5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .card {
    background: #1a1a1f;
    border: 1px solid #2e2e38;
    border-radius: 12px;
    padding: 2rem 2.5rem;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  h1 {
    font-size: 1.3rem;
    font-weight: 600;
    color: #f0f0f5;
    margin-bottom: 0.4rem;
  }
  .subtitle {
    font-size: 0.85rem;
    color: #888;
    margin-bottom: 1.5rem;
  }
  label {
    display: block;
    font-size: 0.8rem;
    color: #aaa;
    margin-bottom: 0.3rem;
    margin-top: 1rem;
  }
  input[type="email"], input[type="password"] {
    width: 100%;
    padding: 0.6rem 0.8rem;
    background: #0f0f10;
    border: 1px solid #2e2e38;
    border-radius: 6px;
    color: #e2e2e5;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.15s;
  }
  input[type="email"]:focus, input[type="password"]:focus {
    border-color: #6c8cff;
  }
  button[type="submit"] {
    margin-top: 1.5rem;
    width: 100%;
    padding: 0.65rem;
    background: #6c8cff;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  button[type="submit"]:hover { background: #5a7aee; }
  .error {
    margin-top: 1rem;
    padding: 0.5rem 0.75rem;
    background: rgba(220,50,50,0.15);
    border: 1px solid rgba(220,50,50,0.35);
    border-radius: 6px;
    font-size: 0.85rem;
    color: #f08080;
  }
</style>
</head>
<body>
<div class="card">
  <h1>FocusBoard</h1>
  <p class="subtitle">Sign in to connect your account</p>
  <form method="POST" action="/api/oauth/authorize">
    <input type="hidden" name="client_id" value="${escAttr(clientId)}"/>
    <input type="hidden" name="redirect_uri" value="${escAttr(redirectUri)}"/>
    <input type="hidden" name="state" value="${escAttr(state)}"/>
    <input type="hidden" name="code_challenge" value="${escAttr(codeChallenge)}"/>
    <input type="hidden" name="scope" value="${escAttr(scope)}"/>
    <label for="email">Email</label>
    <input type="email" id="email" name="email" autocomplete="email" required/>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required/>
    ${errorHtml}
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`;
}

// ── Phase 6.2: MCP endpoint ────────────────────────────────────────────────────
//
// POST /api/mcp — stateless JSON-RPC using the proven probe shape.
// GET /api/mcp  — 405 (connector may probe with GET; log-free as confirmed by probe)
// DELETE /api/mcp — 405

// GET and DELETE stubs (log-free 405 — the probe confirmed these arrive silently).
app.get("/mcp", (c: Context<AuthEnv>) => c.body(null, 405));
app.delete("/mcp", (c: Context<AuthEnv>) => c.body(null, 405));

// POST /api/mcp — the MCP JSON-RPC endpoint.
// Auth: capture:read (lowest bar to enter). Per-tool scope enforcement happens
// during in-process dispatch (ROUTE_SCOPES re-fires on every sub-request).
// The `server` export (which includes the well-known router) is passed lazily
// as a getFetch callback to avoid circular initialization at module load time.
app.post("/mcp", (c: Context<AuthEnv>) => {
  // Pass a lazy reference to server.fetch so mcp-server.ts can dispatch
  // in-process without importing server at module-init time (circular dep risk).
  return handleMcpRpc(c, () => (req: Request) => Promise.resolve(server.fetch(req)));
});

// ── Well-known router (no basePath — paths arrive as-is from the rewrite) ─────
//
// The vercel.json rewrite already routes /.well-known/(.*) → /api.
// The `server` composed app (below) handles them before the /api basePath app.
// These endpoints are OAuth discovery; they return raw RFC JSON (no envelope).
// ORIGIN is derived from the Host header to work across preview + prod deploys.

const wellKnown = new Hono();

wellKnown.get("/.well-known/oauth-authorization-server", (c) => {
  const host = c.req.header("host") ?? "localhost";
  const ORIGIN = `https://${host}`;
  return c.json({
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}/api/oauth/authorize`,
    token_endpoint: `${ORIGIN}/api/oauth/token`,
    registration_endpoint: `${ORIGIN}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES_SUPPORTED,
  }, 200);
});

// /.well-known/oauth-protected-resource AND /.well-known/oauth-protected-resource/*
wellKnown.get("/.well-known/oauth-protected-resource", (c) => {
  const host = c.req.header("host") ?? "localhost";
  const ORIGIN = `https://${host}`;
  return c.json({
    resource: `${ORIGIN}/api/mcp`,
    authorization_servers: [ORIGIN],
  }, 200);
});

wellKnown.get("/.well-known/oauth-protected-resource/*", (c) => {
  const host = c.req.header("host") ?? "localhost";
  const ORIGIN = `https://${host}`;
  return c.json({
    resource: `${ORIGIN}/api/mcp`,
    authorization_servers: [ORIGIN],
  }, 200);
});

// ── Composed server (well-known + app) — exported for api/index.ts ────────────
//
// `wellKnown` handles /.well-known/* BEFORE the /api basePath app handles
// anything. Existing tests import { app } and use /api/... paths — they keep
// working because `app` itself is unchanged. api/index.ts switches to
// server.fetch; tests that import { app } directly continue to work.
export const server = new Hono().route("/", wellKnown).route("/", app);
