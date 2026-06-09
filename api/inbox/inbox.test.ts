/**
 * Tests for api/inbox/index.ts
 *
 * Covers:
 *   - PAT auth accept/reject
 *   - Scope enforcement (capture:read required)
 *   - Snooze-visibility filter: the query uses .or() with snoozed_until conditions
 *   - Returns { items, total } shape
 *   - 500 on Supabase error
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Mock state ───────────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockQueryResult: { data: Record<string, unknown>[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

// Track calls for assertion
let orCallArg = "";

// ─── Module mocks ─────────────────────────────────────────────────────────────

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
}));

vi.mock("../_lib/cors.js", () => ({
  setCorsHeaders: vi.fn(),
  handlePreflight: vi.fn(() => false),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    // Build a fully chainable query mock for the inbox handler's query shape:
    //   .from().select().eq().or().order().limit()
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn((arg: string) => {
        orCallArg = arg;
        return chain;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => mockQueryResult),
    };

    return {
      from: vi.fn(() => chain),
      auth: { getUser: vi.fn() },
    };
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: "GET",
    headers: { authorization: "Bearer fb_pat_testtokenvalue" },
    body: null,
    ...overrides,
  } as unknown as VercelRequest;
}

function makeRes(): { res: VercelResponse; status: MockInstance; json: MockInstance } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json, end: vi.fn() });
  const res = { status, json, setHeader: vi.fn(), end: vi.fn() } as unknown as VercelResponse;
  return { res, status, json };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("inbox/index.ts — GET endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orCallArg = "";
    mockQueryResult = { data: [], error: null };
    mockResolvedToken = {
      userId: "user-abc",
      scopes: ["capture:read"],
      tokenId: "token-1",
    };
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });

  it("returns 405 for non-GET requests", async () => {
    const { default: handler } = await import("./index.js");
    const req = makeReq({ method: "POST" });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(405);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Method not allowed" }));
  });

  it("returns 401 when no PAT token", async () => {
    mockResolvedToken = null;
    const { default: handler } = await import("./index.js");
    const req = makeReq({ headers: {} });
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthorized" }));
  });

  it("returns 403 when PAT lacks capture:read scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:write"], tokenId: "token-1" };
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Insufficient scope" }));
  });

  it("returns { items: [], total: 0 } when no captures exist", async () => {
    mockQueryResult = { data: [], error: null };
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ items: [], total: 0 });
  });

  it("returns pending captures and a correct total", async () => {
    const now = new Date().toISOString();
    mockQueryResult = {
      data: [
        {
          id: "cap-1",
          raw_content: "Build the feature",
          source: "in_app",
          status: "pending",
          created_at: now,
          snoozed_until: null,
          confidence: null,
          parsed_cards: null,
          processed_at: null,
        },
        {
          id: "cap-2",
          raw_content: "Fix the bug",
          source: "in_app",
          status: "pending",
          created_at: now,
          snoozed_until: null,
          confidence: null,
          parsed_cards: null,
          processed_at: null,
        },
      ],
      error: null,
    };

    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const result = json.mock.calls[0][0] as { items: unknown[]; total: number };
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("snooze-visibility: query uses .or() with snoozed_until IS NULL and lte conditions", async () => {
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res } = makeRes();

    await handler(req, res);

    // The handler passes the snooze filter to Postgres via .or() — verify both conditions present
    expect(orCallArg).toContain("snoozed_until.is.null");
    expect(orCallArg).toContain("snoozed_until.lte.");
  });

  it("returns 500 on Supabase query error", async () => {
    mockQueryResult = { data: null, error: { message: "Connection refused" } };
    const { default: handler } = await import("./index.js");
    const req = makeReq();
    const { res, status, json } = makeRes();

    await handler(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "Failed to fetch inbox" }));
  });
});
