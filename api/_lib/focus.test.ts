/**
 * Tests for the focus-session routes (Phase 3): GET /api/focus/status,
 * POST /api/focus/start, POST /api/focus/stop. Supabase + the token resolver
 * are mocked; the one-active-session invariant is the DB's partial unique
 * index, so the start route's 23505 → 409 ALREADY_ACTIVE mapping is what we
 * verify here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockActiveRow: Record<string, unknown> | null = null;
let mockTodayRows: Record<string, unknown>[] = [];
let mockInsertErrorCode: string | null = null;
let mockStopRow: Record<string, unknown> | null = null;
let mockBoardState: Record<string, unknown> | null = null;
let lastInsertPayload: Record<string, unknown> | null = null;

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
  isOAuthToken: vi.fn((token: string | undefined) =>
    typeof token === "string" && token.startsWith("fb_oat_")
  ),
  resolveOAuthToken: vi.fn(async () => null),
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
        // Since 4b loadBoard reads cards from the cards table: serve
        // mockBoardState.cards as rows.
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
      // focus_sessions
      const selectChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gte: vi.fn(async () => ({ data: mockTodayRows, error: null })),
        maybeSingle: vi.fn(async () => ({ data: mockActiveRow, error: null })),
      };
      const insertChain = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn(async () =>
          mockInsertErrorCode
            ? { data: null, error: { code: mockInsertErrorCode, message: "dup" } }
            : { data: { id: "fs-1", started_at: "2026-06-09T21:00:00.000Z" }, error: null }
        ),
      };
      const updateChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: mockStopRow, error: null })),
      };
      return {
        select: vi.fn(() => selectChain),
        insert: vi.fn((payload: Record<string, unknown>) => {
          lastInsertPayload = payload;
          return insertChain;
        }),
        update: vi.fn(() => updateChain),
      };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };

const PAT = "Bearer fb_pat_focustoken";

function post(path: string, body: Record<string, unknown> = {}, token = PAT) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = { userId: "user-abc", scopes: ["focus:read", "focus:write"], tokenId: "t1" };
  mockActiveRow = null;
  mockTodayRows = [];
  mockInsertErrorCode = null;
  mockStopRow = null;
  mockBoardState = null;
  lastInsertPayload = null;
});

describe("focus routes — auth", () => {
  it("status requires focus:read", async () => {
    mockResolvedToken = { userId: "u", scopes: ["capture:read"], tokenId: "t" };
    const res = await app.request("/api/focus/status", { headers: { Authorization: PAT } });
    expect(res.status).toBe(403);
  });

  it("start/stop require focus:write", async () => {
    mockResolvedToken = { userId: "u", scopes: ["focus:read"], tokenId: "t" };
    expect((await post("/api/focus/start")).status).toBe(403);
    expect((await post("/api/focus/stop")).status).toBe(403);
  });
});

describe("POST /api/focus/start", () => {
  it("starts a session without a card", async () => {
    const res = await post("/api/focus/start", { plannedMinutes: 50 });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ id: string; plannedMinutes: number; cardId: null }>;
    expect(body.data.id).toBe("fs-1");
    expect(body.data.plannedMinutes).toBe(50);
    expect(body.data.cardId).toBeNull();
    expect(lastInsertPayload).toMatchObject({ user_id: "user-abc", planned_minutes: 50, source: "cli" });
  });

  it("maps the unique-index violation to 409 ALREADY_ACTIVE with a hint", async () => {
    mockInsertErrorCode = "23505";
    const res = await post("/api/focus/start");
    expect(res.status).toBe(409);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("ALREADY_ACTIVE");
    expect(body.error.hint).toContain("fb focus stop");
  });

  it("denormalises the card title and 404s on unknown cards", async () => {
    mockBoardState = {
      cards: [{ id: "card-1", column: "doing", title: "Deep work", order: 0, createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" }],
      columns: [{ id: "doing", title: "Doing", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 }],
      tags: [],
    };
    const okRes = await post("/api/focus/start", { cardId: "card-1" });
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json() as OkBody<{ cardTitle: string }>;
    expect(okBody.data.cardTitle).toBe("Deep work");

    const badRes = await post("/api/focus/start", { cardId: "ghost" });
    expect(badRes.status).toBe(404);
    const badBody = await badRes.json() as ErrBody;
    expect(badBody.error.code).toBe("NOT_FOUND");
  });

  it("clamps plannedMinutes into 1..480", async () => {
    await post("/api/focus/start", { plannedMinutes: 99999 });
    expect(lastInsertPayload?.planned_minutes).toBe(480);
  });
});

describe("POST /api/focus/stop", () => {
  it("stops the active session and reports actual minutes", async () => {
    mockStopRow = {
      id: "fs-1", card_id: "card-1", card_title: "Deep work", planned_minutes: 25,
      started_at: "2026-06-09T20:00:00.000Z", ended_at: "2026-06-09T20:30:00.000Z", outcome: "progressed",
    };
    const res = await post("/api/focus/stop", { outcome: "progressed" });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ actualMinutes: number; outcome: string }>;
    expect(body.data.actualMinutes).toBe(30);
    expect(body.data.outcome).toBe("progressed");
  });

  it("404s when no session is active", async () => {
    mockStopRow = null;
    const res = await post("/api/focus/stop");
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.hint).toContain("fb focus start");
  });

  it("rejects unknown outcomes with the allowed list", async () => {
    const res = await post("/api/focus/stop", { outcome: "vibed" });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.hint).toContain("progressed");
  });
});

describe("GET /api/focus/status", () => {
  it("returns the active session and today's totals", async () => {
    mockActiveRow = {
      id: "fs-9", card_id: null, card_title: null, planned_minutes: 25,
      started_at: "2026-06-09T20:50:00.000Z", source: "cli",
    };
    mockTodayRows = [
      { planned_minutes: 25, started_at: "2026-06-09T10:00:00.000Z", ended_at: "2026-06-09T10:25:00.000Z", outcome: "completed" },
      { planned_minutes: 50, started_at: "2026-06-09T12:00:00.000Z", ended_at: "2026-06-09T12:40:00.000Z", outcome: "progressed" },
    ];
    const res = await app.request("/api/focus/status", { headers: { Authorization: PAT } });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ active: { id: string } | null; today: { sessions: number; focusedMinutes: number } }>;
    expect(body.data.active?.id).toBe("fs-9");
    expect(body.data.today).toEqual({ sessions: 2, focusedMinutes: 65 });
  });

  it("returns active: null when idle", async () => {
    const res = await app.request("/api/focus/status", { headers: { Authorization: PAT } });
    const body = await res.json() as OkBody<{ active: null }>;
    expect(body.data.active).toBeNull();
  });
});
