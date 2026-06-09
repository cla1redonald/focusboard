/**
 * Tests for the Hono router (api/_lib/hono-app.ts).
 *
 * Covers:
 *   - POST /api/capture (no action / action='capture'): PAT accept/reject,
 *     scope enforcement, idempotency, rate limiting, auto_add=false for PAT
 *   - POST /api/capture action='snooze': PAT auth, scope, sets snoozed_until,
 *     404 on missing row, clamp bounds
 *   - POST /api/capture action='dismiss': PAT auth, scope, sets status=dismissed,
 *     404 on missing row
 *   - GET /api/capture (inbox): PAT auth, scope (capture:read),
 *     snooze-visibility filter, { items, total } shape, 500 on Supabase error
 *
 * All Supabase calls and the token resolver are mocked — no network calls made.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { app } from "../_lib/hono-app.js";

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;

let lastInsertPayload: Record<string, unknown> | null = null;
let mockSelectCount = 0;
let mockExistingRow: { id: string } | null = null;
let mockInsertId = "capture-123";
let mockInsertErrorCode: string | null = null;
let mockUpdateData: { id: string } | null = { id: "capture-123" };
let mockRacedRow: { id: string } | null = null;

let mockQueryResult: { data: Record<string, unknown>[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let orCallArg = "";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../_lib/token.js", () => ({
  resolveApiToken: vi.fn(async () => mockResolvedToken),
  hasScope: vi.fn((resolved: { scopes: string[] }, scope: string) =>
    resolved.scopes.includes(scope)
  ),
  SCOPES: {
    CAPTURE_READ: "capture:read",
    CAPTURE_WRITE: "capture:write",
    CARD_WRITE: "card:write",
  },
  isPat: vi.fn((token: string | undefined) =>
    typeof token === "string" && token.startsWith("fb_pat_")
  ),
  generateToken: vi.fn(() => ({ plaintext: "fb_pat_generated", hash: "hashed" })),
  hashToken: vi.fn((t: string) => t + "_hashed"),
  bearerToken: vi.fn((req: { headers: Record<string, string> }) =>
    req.headers.authorization?.replace("Bearer ", "")
  ),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

// Idempotency lookup call counter
let idempKeyCallCount = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const updateChain = {
      eq: vi.fn(),
      is: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: mockUpdateData, error: null })),
    };
    updateChain.eq.mockReturnValue(updateChain);
    updateChain.is.mockReturnValue(updateChain);
    updateChain.select.mockReturnValue(updateChain);

    const insertChain = {
      select: vi.fn().mockReturnThis(),
      single: vi.fn(async () => {
        if (mockInsertErrorCode) {
          return { data: null, error: { code: mockInsertErrorCode, message: "dup key" } };
        }
        return { data: { id: mockInsertId }, error: null };
      }),
    };

    const countChain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn(async () => ({ count: mockSelectCount, error: null })),
    };

    const merged = {
      eq: vi.fn().mockReturnThis(),
      or: vi.fn((arg: string) => {
        orCallArg = arg;
        return merged;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => mockQueryResult),
      maybeSingle: vi.fn(async () => {
        idempKeyCallCount++;
        if (idempKeyCallCount <= 1) {
          return { data: mockExistingRow, error: null };
        }
        return { data: mockRacedRow, error: null };
      }),
    };

    return {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      from: vi.fn((_table: string) => ({
        select: vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return countChain;
          return merged;
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          lastInsertPayload = payload;
          return insertChain;
        }),
        update: vi.fn(() => updateChain),
      })),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
      },
    };
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAT_TOKEN = "Bearer fb_pat_testtokenvalue";

async function postCapture(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return app.request("/api/capture", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: PAT_TOKEN,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function getInbox(extraHeaders: Record<string, string> = {}) {
  return app.request("/api/capture", {
    method: "GET",
    headers: {
      Authorization: PAT_TOKEN,
      ...extraHeaders,
    },
  });
}

function resetState() {
  lastInsertPayload = null;
  mockSelectCount = 0;
  mockExistingRow = null;
  mockInsertId = "capture-123";
  mockInsertErrorCode = null;
  mockUpdateData = { id: "capture-123" };
  mockRacedRow = null;
  idempKeyCallCount = 0;
  orCallArg = "";
  mockQueryResult = { data: [], error: null };
  mockResolvedToken = {
    userId: "user-abc",
    scopes: ["capture:write"],
    tokenId: "token-1",
  };
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.WEBHOOK_SECRET = "webhook-secret-value";
  process.env.FOCUSBOARD_USER_ID = "webhook-user-id";
}

// ─── POST capture tests ───────────────────────────────────────────────────────

describe("Hono /api/capture — POST capture (no action / PAT auth path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("accepts a valid PAT with capture:write scope and returns captureId", async () => {
    const res = await postCapture({ content: "Hello world" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; captureId: string };
    expect(body.success).toBe(true);
    expect(body.captureId).toBe("capture-123");
  });

  it("rejects requests with no token (401)", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient scope");
  });

  it("returns 429 when rate limit exceeded (> 30 in last 60s)", async () => {
    mockSelectCount = 31;
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Rate limit exceeded");
  });

  it("returns 429 when count is exactly at the limit (30)", async () => {
    mockSelectCount = 30;
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Rate limit exceeded");
  });

  it("idempotency: returns existing captureId without re-inserting on duplicate key", async () => {
    mockExistingRow = { id: "existing-capture-456" };
    const res = await postCapture(
      { content: "Hello world" },
      { "Idempotency-Key": "my-unique-key-123" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { captureId: string };
    expect(body.captureId).toBe("existing-capture-456");
    expect(lastInsertPayload).toBeNull();
  });

  it("idempotency: on Postgres 23505 unique violation, returns existing row id", async () => {
    mockExistingRow = null;
    mockInsertErrorCode = "23505";
    mockRacedRow = { id: "raced-capture-789" };

    const res = await postCapture(
      { content: "race test" },
      { "Idempotency-Key": "race-condition-key" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { captureId: string };
    expect(body.captureId).toBe("raced-capture-789");
  });

  it("passes auto_add: false to process endpoint for PAT captures", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const { waitUntil } = await import("@vercel/functions");
    const waitUntilSpy = vi.mocked(waitUntil) as MockInstance;

    const res = await postCapture({ content: "Hello world" });
    expect(res.status).toBe(200);

    const calls = waitUntilSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    await calls[0][0];

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/capture/process"),
      expect.objectContaining({
        body: expect.stringContaining('"auto_add":false'),
      })
    );

    fetchSpy.mockRestore();
  });
});

// ─── POST action='snooze' tests ───────────────────────────────────────────────

describe("Hono /api/capture — POST action='snooze'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "snooze", captureId: "cap-1", minutes: 30 }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postCapture({ action: "snooze", captureId: "cap-1", minutes: 30 });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient scope");
  });

  it("sets snoozed_until and returns ok + snoozedUntil", async () => {
    const before = Date.now();
    const res = await postCapture({ action: "snooze", captureId: "cap-1", minutes: 60 });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; snoozedUntil: string };
    expect(body.ok).toBe(true);
    expect(body.snoozedUntil).toBeDefined();
    const snoozedMs = new Date(body.snoozedUntil).getTime();
    expect(snoozedMs).toBeGreaterThan(before + 59 * 60 * 1000);
    expect(snoozedMs).toBeLessThan(before + 61 * 60 * 1000);
  });

  it("clamps minutes below minimum to 1", async () => {
    const before = Date.now();
    const res = await postCapture({ action: "snooze", captureId: "cap-1", minutes: -5 });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; snoozedUntil: string };
    const snoozedMs = new Date(body.snoozedUntil).getTime();
    expect(snoozedMs).toBeGreaterThan(before);
    expect(snoozedMs).toBeLessThan(before + 2 * 60 * 1000);
  });

  it("clamps minutes above maximum to 43200", async () => {
    const before = Date.now();
    const res = await postCapture({ action: "snooze", captureId: "cap-1", minutes: 99999 });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; snoozedUntil: string };
    const snoozedMs = new Date(body.snoozedUntil).getTime();
    const maxMs = before + 43200 * 60 * 1000;
    expect(snoozedMs).toBeLessThanOrEqual(maxMs + 1000);
  });

  it("returns 404 when capture row not found (wrong user or id)", async () => {
    mockUpdateData = null;
    const res = await postCapture({ action: "snooze", captureId: "nonexistent", minutes: 30 });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Capture not found");
  });
});

// ─── POST action='dismiss' tests ──────────────────────────────────────────────

describe("Hono /api/capture — POST action='dismiss'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss", captureId: "cap-1" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postCapture({ action: "dismiss", captureId: "cap-1" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient scope");
  });

  it("sets status=dismissed and returns ok:true", async () => {
    const res = await postCapture({ action: "dismiss", captureId: "cap-1" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 404 when capture row not found", async () => {
    mockUpdateData = null;
    const res = await postCapture({ action: "dismiss", captureId: "nonexistent" });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Capture not found");
  });
});

// ─── GET inbox tests ──────────────────────────────────────────────────────────

describe("Hono /api/capture — GET inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mockResolvedToken = {
      userId: "user-abc",
      scopes: ["capture:read"],
      tokenId: "token-1",
    };
  });

  it("returns 405 for unsupported methods (e.g. PUT)", async () => {
    const res = await app.request("/api/capture", {
      method: "PUT",
      headers: { Authorization: PAT_TOKEN },
    });
    expect(res.status).toBe(405);
  });

  it("returns 401 when no PAT token", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", { method: "GET" });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when PAT lacks capture:read scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:write"], tokenId: "token-1" };
    const res = await getInbox();
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient scope");
  });

  it("returns { items: [], total: 0 } when no captures exist", async () => {
    mockQueryResult = { data: [], error: null };
    const res = await getInbox();
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; total: number };
    expect(body).toEqual({ items: [], total: 0 });
  });

  it("returns pending captures and a correct total", async () => {
    const now = new Date().toISOString();
    mockQueryResult = {
      data: [
        { id: "cap-1", raw_content: "Build the feature", source: "in_app", status: "pending",
          created_at: now, snoozed_until: null, confidence: null, parsed_cards: null, processed_at: null },
        { id: "cap-2", raw_content: "Fix the bug", source: "in_app", status: "pending",
          created_at: now, snoozed_until: null, confidence: null, parsed_cards: null, processed_at: null },
      ],
      error: null,
    };

    const res = await getInbox();
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it("snooze-visibility: query uses .or() with snoozed_until IS NULL and lte conditions", async () => {
    await getInbox();
    expect(orCallArg).toContain("snoozed_until.is.null");
    expect(orCallArg).toContain("snoozed_until.lte.");
  });

  it("returns 500 on Supabase query error", async () => {
    mockQueryResult = { data: null, error: { message: "Connection refused" } };
    const res = await getInbox();
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Failed to fetch inbox");
  });
});
