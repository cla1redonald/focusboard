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
import { buildTodayPlan, buildTodayDailyPlan, getActiveCards } from "../../src/app/today.js";
import { buildDailyShutdownSummary, buildWeeklyReviewSummary } from "../../src/app/review.js";
import { filterCards, DEFAULT_FILTER } from "../../src/app/filters.js";
import type { Card } from "../../src/app/types.js";
import { createHash, randomBytes } from "crypto";
import { CONFIRMATION_TOOL_ALLOWLIST, executeConfirmedOp } from "./confirm-executor.js";

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
      ...(typeof body.notes === "string" && body.notes ? { notes: body.notes.slice(0, 5000) } : {}),
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
      patch.notes = body.notes === null ? null : (body.notes as string).slice(0, 5000);
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

// ── Phase 6 step 0: connector probe (THROWAWAY — delete after the probe) ───────
//
// A minimal, stateless, UNAUTHENTICATED MCP endpoint whose only job is to learn
// what claude.ai's custom-connector client ACTUALLY sends (Accept negotiation,
// GET/SSE channel attempts, protocol version, session headers, timing) — the
// official SDK client negotiates politely and cannot reproduce connector
// behaviour. Exposes ONE harmless echo tool; touches NO data. Every request is
// logged to the function logs with a "mcp-probe:" prefix for later analysis.

function probeLog(c: Context, note: string) {
  console.log("mcp-probe:", JSON.stringify({
    note,
    method: c.req.method,
    accept: c.req.header("accept") ?? null,
    contentType: c.req.header("content-type") ?? null,
    protocolVersion: c.req.header("mcp-protocol-version") ?? null,
    sessionId: c.req.header("mcp-session-id") ?? null,
    ua: (c.req.header("user-agent") ?? "").slice(0, 80),
  }));
}

app.get("/mcp-probe", (c) => {
  probeLog(c, "GET (SSE channel attempt?)");
  return c.body(null, 405);
});

app.delete("/mcp-probe", (c) => {
  probeLog(c, "DELETE (session teardown attempt?)");
  return c.body(null, 405);
});

app.post("/mcp-probe", async (c) => {
  let rpc: { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
  try {
    rpc = (await c.req.json()) as typeof rpc;
  } catch {
    probeLog(c, "POST unparseable body");
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  probeLog(c, `POST ${rpc.method ?? "(no method)"}`);

  // Notifications (no id) → 202 Accepted, empty body (streamable-http spec).
  if (rpc.id === undefined || rpc.id === null) {
    return c.body(null, 202);
  }

  const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id: rpc.id, result });

  switch (rpc.method) {
    case "initialize":
      return reply({
        protocolVersion: (rpc.params?.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "focusboard-probe", version: "0.0.1" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: [{
          name: "probe_echo",
          description: "Echo a message back (connectivity probe — no data access).",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string", description: "Text to echo" } },
            required: ["text"],
          },
        }],
      });
    case "tools/call": {
      const args = (rpc.params?.arguments ?? {}) as { text?: string };
      return reply({
        content: [{ type: "text", text: `probe echo: ${args.text ?? "(no text)"}` }],
        isError: false,
      });
    }
    default:
      return c.json(
        { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } },
        200
      );
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
