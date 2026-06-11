/**
 * Tests for the Phase 5a routes: GET /api/focus/history, GET /api/review/daily,
 * GET /api/review/weekly, POST /api/capture/batch.
 *
 * The digest PROJECTION LOGIC (review.ts) is the real code the web renders
 * from; here we verify the API contract around it: scope enforcement (incl.
 * the focus-data scope-leak regression), the table-sourced focus sessions,
 * aggregates-only focus exposure, and batch capture idempotency/limits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockBoardState: Record<string, unknown> | null = null;
let mockFocusRows: Record<string, unknown>[] = [];
let mockMetricsBlob: Record<string, unknown> | null = null;
let mockCaptureCount = 0;
let mockExistingKeys: { id: string; idempotency_key: string }[] = [];
let capturedInserts: Record<string, unknown>[] = [];

vi.mock("./token.js", () => ({
  resolveApiToken: vi.fn(async () => mockResolvedToken),
  hasScope: vi.fn((resolved: { scopes: string[] }, scope: string) =>
    resolved.scopes.includes(scope)
  ),
  SCOPES: {
    CAPTURE_READ: "capture:read",
    CAPTURE_WRITE: "capture:write",
    BOARD_READ: "board:read",
    FOCUS_READ: "focus:read",
    FOCUS_WRITE: "focus:write",
    CARD_WRITE: "card:write",
  },
  isPat: vi.fn((token: string | undefined) =>
    typeof token === "string" && token.startsWith("fb_pat_")
  ),
  generateToken: vi.fn(() => ({ plaintext: "fb_pat_generated", hash: "hashed" })),
  hashToken: vi.fn((t: string) => t + "_hashed"),
  bearerToken: vi.fn((authHeader: string | undefined | null) =>
    typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : undefined
  ),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "app_state") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: mockBoardState ? { state: mockBoardState } : null,
            error: null,
          })),
        };
      }
      if (table === "cards") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(async () => ({
            data: ((mockBoardState?.cards as Record<string, unknown>[] | undefined) ?? []).map(
              (c, i) => ({ id: c.id, card_json: c, version: i + 1 })
            ),
            error: null,
          })),
        };
      }
      if (table === "focus_sessions") {
        // loadFocusSessions: select().eq().not().gte().order() → awaited
        const chain: Record<string, unknown> = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          not: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          order: vi.fn(async () => ({ data: mockFocusRows, error: null })),
          is: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        };
        return chain;
      }
      if (table === "metrics") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: mockMetricsBlob ? { metrics: mockMetricsBlob } : null,
            error: null,
          })),
        };
      }
      if (table === "capture_queue") {
        const chain: Record<string, unknown> = {
          // count pre-check: select("id", {count}) .eq() .gte() → awaited
          select: vi.fn((_cols?: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              const headChain = {
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn(async () => ({ count: mockCaptureCount, error: null })),
              };
              return headChain;
            }
            return chain;
          }),
          eq: vi.fn(() => chain),
          in: vi.fn(async () => ({ data: mockExistingKeys, error: null })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            capturedInserts.push(payload);
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn(async () => ({
                data: { id: `cap-${capturedInserts.length}` },
                error: null,
              })),
            };
          }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };

const PAT = "Bearer fb_pat_p5token";

const COLUMNS = [
  { id: "backlog", title: "Backlog", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 },
  { id: "doing", title: "Doing", icon: "i", color: "c", wipLimit: 2, isTerminal: false, order: 1 },
  { id: "blocked", title: "Blocked", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 2 },
  { id: "done", title: "Done", icon: "i", color: "c", wipLimit: null, isTerminal: true, order: 3 },
];

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id, column: "backlog", title: `Card ${id}`, order: 1,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: new Date().toISOString(), ...over,
  };
}

function boardState(cards: unknown[]) {
  return { cards, columns: COLUMNS, templates: [], settings: {}, tagCategories: [], tags: [] };
}

function focusRow(over: Record<string, unknown> = {}) {
  const ended = (over.ended_at as string) ?? new Date().toISOString();
  return {
    id: "fs-1", card_id: "a", card_title: "Card a", planned_minutes: 25,
    started_at: new Date(new Date(ended).getTime() - 25 * 60_000).toISOString(),
    ended_at: ended, outcome: "progressed", note: null, ...over,
  };
}

function req(method: string, path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: PAT, ...headers },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = {
    userId: "user-abc",
    scopes: ["capture:read", "capture:write", "board:read", "focus:read", "focus:write"],
    tokenId: "t1",
  };
  mockBoardState = boardState([card("a")]);
  mockFocusRows = [];
  mockMetricsBlob = { completedCards: [], dailySnapshots: [], wipViolations: 0, currentStreak: 0, longestStreak: 0 };
  mockCaptureCount = 0;
  mockExistingKeys = [];
  capturedInserts = [];
});

describe("Phase 5a — scope enforcement", () => {
  it("GET /api/focus/history requires focus:read", async () => {
    mockResolvedToken = { userId: "u", scopes: ["board:read"], tokenId: "t" };
    expect((await req("GET", "/api/focus/history")).status).toBe(403);
  });

  it.each(["/api/review/daily", "/api/review/weekly"])("%s requires board:read", async (path) => {
    mockResolvedToken = { userId: "u", scopes: ["focus:read"], tokenId: "t" };
    expect((await req("GET", path)).status).toBe(403);
  });

  it("POST /api/capture/batch requires capture:write", async () => {
    mockResolvedToken = { userId: "u", scopes: ["capture:read", "board:read"], tokenId: "t" };
    expect((await req("POST", "/api/capture/batch", { items: [{ content: "x" }] })).status).toBe(403);
  });
});

describe("scope-leak regression: digests expose focus AGGREGATES only", () => {
  it("a board:read-ONLY token gets the digest with no raw session rows anywhere", async () => {
    mockResolvedToken = { userId: "u", scopes: ["board:read"], tokenId: "t" };
    mockFocusRows = [focusRow(), focusRow({ id: "fs-2", outcome: "completed", note: "secret note" })];

    const res = await req("GET", "/api/review/daily");
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ focus: Record<string, unknown> }>;

    expect(Object.keys(body.data.focus).sort()).toEqual(["byOutcome", "sessionCount", "totalMinutes"]);
    // No raw session fields may appear anywhere in the digest payload.
    const raw = JSON.stringify(body.data);
    expect(raw).not.toContain("startedAt");
    expect(raw).not.toContain("secret note");
    expect(raw).not.toContain("focusSessions");
  });
});

describe("GET /api/focus/history", () => {
  it("returns table-sourced sessions with aggregates and per-day buckets", async () => {
    const today = new Date().toISOString();
    mockFocusRows = [
      focusRow({ id: "fs-1", ended_at: today }),
      focusRow({ id: "fs-2", ended_at: today, outcome: "completed", planned_minutes: 50 }),
    ];
    const res = await req("GET", "/api/focus/history?days=14");
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{
      days: number; sessionCount: number; totalMinutes: number;
      byOutcome: Record<string, number>; byDay: Record<string, { minutes: number }>;
      sessions: { id: string; note?: string }[];
    }>;
    expect(body.data.days).toBe(14);
    expect(body.data.sessionCount).toBe(2);
    expect(body.data.totalMinutes).toBe(50); // 25m each
    expect(body.data.byOutcome).toEqual({ progressed: 1, completed: 1 });
    expect(Object.values(body.data.byDay)[0]!.minutes).toBe(50);
    expect(body.data.sessions.map((s) => s.id)).toEqual(["fs-1", "fs-2"]);
  });

  it("clamps days to 1..90", async () => {
    const res = await req("GET", "/api/focus/history?days=5000");
    const body = await res.json() as OkBody<{ days: number }>;
    expect(body.data.days).toBe(90);
  });
});

describe("GET /api/review/daily", () => {
  it("uses the web's review semantics: slipped/blocked/stale + tomorrow candidates with versions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockBoardState = boardState([
      card("slipped-1", { dueDate: "2020-01-01" }),
      card("blocked-1", { column: "blocked" }),
      card("stale-1", { updatedAt: "2020-01-01T00:00:00.000Z" }),
      card("fresh-1", { column: "doing" }),
      card("done-1", { column: "done" }), // terminal — excluded from active lists
    ]);
    mockMetricsBlob = {
      completedCards: [{ cardId: "done-1", title: "Done thing", createdAt: "2026-06-01T00:00:00Z", completedAt: `${today}T10:00:00.000Z`, leadTimeMs: 1, cycleTimeMs: 1 }],
      dailySnapshots: [], wipViolations: 0, currentStreak: 0, longestStreak: 0,
      // A stale blob copy of focusSessions that must be IGNORED (table wins):
      focusSessions: [{ id: "blob-ghost", cardId: "x", cardTitle: "ghost", plannedMinutes: 25, startedAt: "2020-01-01T00:00:00Z", endedAt: `${today}T01:00:00.000Z`, outcome: "progressed" }],
    };
    mockFocusRows = [focusRow()];

    const res = await req("GET", "/api/review/daily");
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{
      completedToday: { cardId: string }[];
      focus: { sessionCount: number };
      slipped: { id: string; version: number | null }[];
      blocked: { id: string }[];
      stale: { id: string }[];
      tomorrowCandidates: { id: string }[];
    }>;

    expect(body.data.completedToday.map((d) => d.cardId)).toEqual(["done-1"]);
    expect(body.data.slipped.map((d) => d.id)).toEqual(["slipped-1"]);
    expect(body.data.blocked.map((d) => d.id)).toEqual(["blocked-1"]);
    expect(body.data.stale.map((d) => d.id)).toContain("stale-1");
    expect(body.data.tomorrowCandidates.map((d) => d.id)).not.toContain("blocked-1");
    expect(body.data.slipped[0]!.version).not.toBeNull(); // mutation-ready
    // table truth, not the blob ghost: exactly 1 session counted
    expect(body.data.focus.sessionCount).toBe(1);
  });

  it("404s with the open-the-web-app hint when no board exists", async () => {
    mockBoardState = null;
    const res = await req("GET", "/api/review/daily");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/capture/batch", () => {
  it("captures every item and reports per-item results", async () => {
    const res = await req("POST", "/api/capture/batch",
      { items: [{ content: "one" }, { content: "two" }, { content: "three" }] },
      { "Idempotency-Key": "batch-1" });
    expect(res.status).toBe(201);
    const body = await res.json() as OkBody<{ total: number; captured: number; results: { ok: boolean }[] }>;
    expect(body.data.total).toBe(3);
    expect(body.data.captured).toBe(3);
    expect(capturedInserts).toHaveLength(3);
    // Per-item keys are derived + delimited, and stored:
    const keys = capturedInserts.map((p) => p.idempotency_key);
    expect(new Set(keys).size).toBe(3);
  });

  it("a retried batch (same Idempotency-Key) re-inserts nothing", async () => {
    const { createHash } = await import("crypto");
    const keyFor = (i: number) => createHash("sha256").update(`batch-2:${i}`).digest("hex");
    mockExistingKeys = [0, 1].map((i) => ({ id: `existing-${i}`, idempotency_key: keyFor(i) }));

    const res = await req("POST", "/api/capture/batch",
      { items: [{ content: "one" }, { content: "two" }] },
      { "Idempotency-Key": "batch-2" });
    const body = await res.json() as OkBody<{ captured: number; results: { duplicate?: boolean; captureId?: string }[] }>;
    expect(body.data.captured).toBe(2);
    expect(body.data.results.every((r) => r.duplicate)).toBe(true);
    expect(capturedInserts).toHaveLength(0);
  });

  it("refuses a batch that would exceed the rate limit", async () => {
    mockCaptureCount = 28; // 28 used + 5 requested > 30
    const res = await req("POST", "/api/capture/batch",
      { items: Array.from({ length: 5 }, (_, i) => ({ content: `item ${i}` })) });
    expect(res.status).toBe(429);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(capturedInserts).toHaveLength(0);
  });

  it("validates items: empty array, oversized batch, empty content", async () => {
    expect((await req("POST", "/api/capture/batch", { items: [] })).status).toBe(400);
    expect((await req("POST", "/api/capture/batch",
      { items: Array.from({ length: 26 }, () => ({ content: "x" })) })).status).toBe(400);
    expect((await req("POST", "/api/capture/batch", { items: [{ content: "  " }] })).status).toBe(400);
  });
});
