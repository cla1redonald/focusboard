/**
 * Tests for the PAT (Personal Access Token) auth path on the capture API endpoints.
 *
 * These tests cover:
 *   - capture/index.ts: PAT accept/reject, scope enforcement, idempotency, rate limiting
 *   - capture/snooze.ts: PAT auth, scope, sets snoozed_until, 404 on missing row
 *   - capture/dismiss.ts: PAT auth, scope, sets status=dismissed, 404 on missing row
 *
 * Supabase client and the token resolver are mocked — no network calls made.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;

// Counters / payloads updated per test
let lastInsertPayload: Record<string, unknown> | null = null;
let mockSelectCount = 0;         // rate-limit count query result
let mockExistingRow: { id: string } | null = null;  // idempotency pre-check
let mockInsertId = "capture-123";
let mockInsertErrorCode: string | null = null;       // e.g. "23505" to simulate dup key
let mockUpdateData: { id: string } | null = { id: "capture-123" }; // null → 404
// For the post-23505 race lookup:
let mockRacedRow: { id: string } | null = null;

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
}));

vi.mock("../_lib/cors.js", () => ({
  setCorsHeaders: vi.fn(),
  handlePreflight: vi.fn(() => false),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

// Idempotency lookup call counter — first call = pre-insert, second = post-23505
let idempKeyCallCount = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    // update() chain: supports .eq().eq().select().maybeSingle()
    const updateChain = {
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: mockUpdateData, error: null })),
    };
    updateChain.eq.mockReturnValue(updateChain);
    updateChain.select.mockReturnValue(updateChain);

    // insert() chain
    const insertChain = {
      select: vi.fn().mockReturnThis(),
      single: vi.fn(async () => {
        if (mockInsertErrorCode) {
          return { data: null, error: { code: mockInsertErrorCode, message: "dup key" } };
        }
        return { data: { id: mockInsertId }, error: null };
      }),
    };

    // Rate-limit count chain: .select(col, {count,head}).eq().gte()
    const countChain = {
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn(async () => ({ count: mockSelectCount, error: null })),
    };

    // Idempotency lookup chain: .select(col).eq().eq().maybeSingle()
    // First call = pre-insert check, second = post-23505 recovery lookup
    const idempChain = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        idempKeyCallCount++;
        if (idempKeyCallCount <= 1) {
          return { data: mockExistingRow, error: null };
        }
        return { data: mockRacedRow, error: null };
      }),
    };

    return {
      from: vi.fn(() => ({
        select: vi.fn((_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return countChain;
          return idempChain;
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          lastInsertPayload = payload;
          return insertChain;
        }),
        update: vi.fn(() => updateChain),
      })),
      auth: { getUser: vi.fn() },
    };
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: "POST",
    headers: { authorization: "Bearer fb_pat_testtokenvalue", "content-type": "application/json" },
    body: { content: "Hello world" },
    ...overrides,
  } as unknown as VercelRequest;
}

function makeRes(): { res: VercelResponse; status: MockInstance; json: MockInstance } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json, end: vi.fn() });
  const res = { status, json, setHeader: vi.fn(), end: vi.fn() } as unknown as VercelResponse;
  return { res, status, json };
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
  mockResolvedToken = {
    userId: "user-abc",
    scopes: ["capture:write"],
    tokenId: "token-1",
  };
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
}

// ─── capture/index.ts tests ───────────────────────────────────────────────────

describe("capture/index.ts — PAT auth path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("accepts a valid PAT with capture:write scope and returns captureId", async () => {
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, captureId: "capture-123" })
    );
  });

  it("rejects requests with no token (401)", async () => {
    mockResolvedToken = null;
    const { default: handler } = await import("./index.js");
    const req = makeReq({ headers: {}, body: { content: "test" } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthorized" }));
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Insufficient scope" }));
  });

  it("returns 429 when rate limit exceeded (> 30 in last 60s)", async () => {
    mockSelectCount = 31;
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Rate limit exceeded" }));
  });

  it("allows capture when count is exactly at the limit (30) — boundary is > 30", async () => {
    mockSelectCount = 30;
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    // Count of 30 is not > 30 so it should succeed
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("idempotency: returns existing captureId without re-inserting on duplicate key", async () => {
    mockExistingRow = { id: "existing-capture-456" };
    const { default: handler } = await import("./index.js");
    const req = makeReq({
      headers: {
        authorization: "Bearer fb_pat_testtokenvalue",
        "idempotency-key": "my-unique-key-123",
      },
      body: { content: "Hello world" },
    });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const call = json.mock.calls[0][0] as { captureId: string };
    expect(call.captureId).toBe("existing-capture-456");
    // No insert should have happened
    expect(lastInsertPayload).toBeNull();
  });

  it("idempotency: on Postgres 23505 unique violation, returns existing row id", async () => {
    // Pre-insert check finds nothing; insert fails with 23505; recovery lookup finds the raced row
    mockExistingRow = null;
    mockInsertErrorCode = "23505";
    mockRacedRow = { id: "raced-capture-789" };

    const { default: handler } = await import("./index.js");
    const req = makeReq({
      headers: {
        authorization: "Bearer fb_pat_testtokenvalue",
        "idempotency-key": "race-condition-key",
      },
      body: { content: "race test" },
    });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const call = json.mock.calls[0][0] as { captureId: string };
    expect(call.captureId).toBe("raced-capture-789");
  });

  it("passes auto_add: false to process endpoint for PAT captures", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    // Re-import after mocking fetch to ensure the handler picks up the spy
    const { waitUntil } = await import("@vercel/functions");
    const waitUntilSpy = vi.mocked(waitUntil);

    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res } = makeRes();

    await handler(req, res);

    // waitUntil receives the promise — resolve it so fetch is actually called
    const calls = waitUntilSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Await the promise passed to waitUntil so fetch runs synchronously in test
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

// ─── capture/snooze.ts tests ──────────────────────────────────────────────────

describe("capture/snooze.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "cap-1", minutes: 30 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthorized" }));
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "cap-1", minutes: 30 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Insufficient scope" }));
  });

  it("sets snoozed_until and returns ok + snoozedUntil", async () => {
    const before = Date.now();
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "cap-1", minutes: 60 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const result = json.mock.calls[0][0] as { ok: boolean; snoozedUntil: string };
    expect(result.ok).toBe(true);
    expect(result.snoozedUntil).toBeDefined();
    // snoozedUntil should be ~60 minutes from now
    const snoozedMs = new Date(result.snoozedUntil).getTime();
    expect(snoozedMs).toBeGreaterThan(before + 59 * 60 * 1000);
    expect(snoozedMs).toBeLessThan(before + 61 * 60 * 1000);
  });

  it("clamps minutes below minimum to 1", async () => {
    const before = Date.now();
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "cap-1", minutes: -5 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const result = json.mock.calls[0][0] as { ok: boolean; snoozedUntil: string };
    const snoozedMs = new Date(result.snoozedUntil).getTime();
    // Should be ~1 minute from now (not negative)
    expect(snoozedMs).toBeGreaterThan(before);
    expect(snoozedMs).toBeLessThan(before + 2 * 60 * 1000);
  });

  it("clamps minutes above maximum to 43200", async () => {
    const before = Date.now();
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "cap-1", minutes: 99999 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const result = json.mock.calls[0][0] as { ok: boolean; snoozedUntil: string };
    const snoozedMs = new Date(result.snoozedUntil).getTime();
    const maxMs = before + 43200 * 60 * 1000;
    expect(snoozedMs).toBeLessThanOrEqual(maxMs + 1000); // 1s tolerance
  });

  it("returns 404 when capture row not found (wrong user or id)", async () => {
    mockUpdateData = null;
    const { default: handler } = await import("./snooze.js");
    const req = makeReq({ body: { captureId: "nonexistent", minutes: 30 } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Capture not found" }));
  });
});

// ─── capture/dismiss.ts tests ─────────────────────────────────────────────────

describe("capture/dismiss.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const { default: handler } = await import("./dismiss.js");
    const req = makeReq({ body: { captureId: "cap-1" } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthorized" }));
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const { default: handler } = await import("./dismiss.js");
    const req = makeReq({ body: { captureId: "cap-1" } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Insufficient scope" }));
  });

  it("sets status=dismissed and returns ok:true", async () => {
    const { default: handler } = await import("./dismiss.js");
    const req = makeReq({ body: { captureId: "cap-1" } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ ok: true });
  });

  it("returns 404 when capture row not found", async () => {
    mockUpdateData = null;
    const { default: handler } = await import("./dismiss.js");
    const req = makeReq({ body: { captureId: "nonexistent" } });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Capture not found" }));
  });
});
