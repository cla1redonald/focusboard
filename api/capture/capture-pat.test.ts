/**
 * Tests for the Hono router (api/_lib/hono-app.ts).
 *
 * Covers (all responses in the { ok, data } / { ok, error: { code, … } } envelope):
 *   - POST /api/capture: PAT accept/reject, scope enforcement, idempotency,
 *     rate limiting, auto_add=false for PAT, legacy action field rejected
 *   - POST /api/capture/:id/snooze: auth, scope, sets snoozed_until,
 *     404 on missing row, clamp bounds
 *   - POST /api/capture/:id/dismiss: auth, scope, sets status=dismissed,
 *     404 on missing row
 *   - GET /api/capture (inbox): auth, scope (capture:read),
 *     snooze-visibility filter, items/total shape, 500 on Supabase error
 *
 * All Supabase calls and the token resolver are mocked — no network calls made.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { app } from "../_lib/hono-app.js";

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
// OAuth access token (fb_oat_...) resolution. null = unknown, expired or revoked,
// which is exactly what the real resolveOAuthToken returns for those cases.
let mockResolvedOAuthToken: { userId: string; scopes: string[]; tokenId: string } | null = null;

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
let inCallArg: string[] = [];

// Session JWT resolution (supabase.auth.getUser). null = not a valid session.
let mockSessionUser: { id: string } | null = null;

// ─── Module mocks ──────────────────────────────────────────────────────────────

// The token helpers mirror the REAL ones in token.ts where it matters for auth
// decisions: bearerToken() returns undefined unless the header starts with
// "Bearer ", and each resolver only resolves a header carrying its own prefix.
// (A looser mock would let a malformed header "authenticate" in tests only.)
vi.mock("../_lib/token.js", () => {
  const bearer = (authHeader: string | undefined | null) => {
    if (typeof authHeader !== "string") return undefined;
    const stripped = authHeader.replace(/^Bearer\s+/i, "");
    return stripped === authHeader ? undefined : stripped;
  };
  const isPat = (token: string | undefined | null) =>
    typeof token === "string" && token.startsWith("fb_pat_");
  const isOAuthToken = (token: string | undefined | null) =>
    typeof token === "string" && token.startsWith("fb_oat_");
  return {
    resolveApiToken: vi.fn(async (authHeader: string | undefined | null) =>
      isPat(bearer(authHeader)) ? mockResolvedToken : null
    ),
    resolveOAuthToken: vi.fn(async (authHeader: string | undefined | null) =>
      isOAuthToken(bearer(authHeader)) ? mockResolvedOAuthToken : null
    ),
    hasScope: vi.fn((resolved: { scopes: string[] }, scope: string) =>
      resolved.scopes.includes(scope)
    ),
    SCOPES: {
      CAPTURE_READ: "capture:read",
      CAPTURE_WRITE: "capture:write",
      CARD_WRITE: "card:write",
    },
    isPat: vi.fn(isPat),
    isOAuthToken: vi.fn(isOAuthToken),
    generateToken: vi.fn(() => ({ plaintext: "fb_pat_generated", hash: "hashed" })),
    hashToken: vi.fn((t: string) => t + "_hashed"),
    bearerToken: vi.fn(bearer),
  };
});

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
      in: vi.fn((_col: string, values: string[]) => {
        inCallArg = values;
        return merged;
      }),
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
        getUser: vi.fn(async () =>
          mockSessionUser
            ? { data: { user: mockSessionUser }, error: null }
            : { data: { user: null }, error: { message: "no user" } }
        ),
      },
    };
  }),
}));

// ─── Envelope types + helpers ─────────────────────────────────────────────────

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };

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

async function postSnooze(id: string, body: Record<string, unknown>, headers: Record<string, string> = { Authorization: PAT_TOKEN }) {
  return app.request(`/api/capture/${id}/snooze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postDismiss(id: string, headers: Record<string, string> = { Authorization: PAT_TOKEN }) {
  return app.request(`/api/capture/${id}/dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
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
  inCallArg = [];
  mockQueryResult = { data: [], error: null };
  mockResolvedToken = {
    userId: "user-abc",
    scopes: ["capture:write"],
    tokenId: "token-1",
  };
  mockResolvedOAuthToken = null;
  mockSessionUser = null;
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.WEBHOOK_SECRET = "webhook-secret-value";
  process.env.FOCUSBOARD_USER_ID = "webhook-user-id";
}

// ─── GET /api/me tests ────────────────────────────────────────────────────────

describe("Hono /api/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
  });

  it("returns the principal for a valid PAT", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: PAT_TOKEN } });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ userId: string; kind: string; scopes: string[] }>;
    expect(body.data).toEqual({ userId: "user-abc", kind: "pat", scopes: ["capture:read"] });
  });

  it("returns 401 without credentials", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
  });
});

// ─── POST capture tests ───────────────────────────────────────────────────────

describe("Hono /api/capture — POST capture (PAT auth path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("accepts a valid PAT with capture:write scope and returns captureId", async () => {
    const res = await postCapture({ content: "Hello world" });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string }>;
    expect(body.ok).toBe(true);
    expect(body.data.captureId).toBe("capture-123");
  });

  it("rejects requests with no token (401 NOT_AUTHENTICATED)", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
  });

  it("returns 403 INSUFFICIENT_SCOPE when PAT lacks capture:write", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("rejects the legacy action field with 400 VALIDATION and a hint", async () => {
    const res = await postCapture({ action: "snooze", captureId: "cap-1", minutes: 30 });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.hint).toContain("/snooze");
  });

  it("returns 429 RATE_LIMITED when rate limit exceeded (> 30 in last 60s)", async () => {
    mockSelectCount = 31;
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(429);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("returns 429 when count is exactly at the limit (30)", async () => {
    mockSelectCount = 30;
    const res = await postCapture({ content: "test" });
    expect(res.status).toBe(429);
  });

  it("idempotency: returns existing captureId without re-inserting on duplicate key", async () => {
    mockExistingRow = { id: "existing-capture-456" };
    const res = await postCapture(
      { content: "Hello world" },
      { "Idempotency-Key": "my-unique-key-123" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string; duplicate?: boolean }>;
    expect(body.data.captureId).toBe("existing-capture-456");
    expect(body.data.duplicate).toBe(true);
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
    const body = await res.json() as OkBody<{ captureId: string; duplicate?: boolean }>;
    expect(body.data.captureId).toBe("raced-capture-789");
    expect(body.data.duplicate).toBe(true);
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

// ─── POST capture tests: OAuth path ───────────────────────────────────────────
//
// POST /api/capture is the one INLINE_AUTH route: it resolves its own principal
// instead of going through authenticate(). It used to have no OAuth branch, so an
// fb_oat_ token (the claude.ai connector) fell through to the session branch and
// came back NOT_AUTHENTICATED. These pin the OAuth branch and its safety posture.

describe("Hono /api/capture — POST capture (OAuth auth path)", () => {
  const OAUTH_TOKEN = "Bearer fb_oat_testtokenvalue";

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    // No PAT on these requests: the caller presents an OAuth access token only.
    mockResolvedToken = null;
    mockResolvedOAuthToken = {
      userId: "user-oauth",
      scopes: ["capture:read", "capture:write"],
      tokenId: "oat-1",
    };
  });

  it("accepts a valid OAuth token with capture:write and inserts a pending row for that user", async () => {
    const res = await postCapture({ content: "From the connector" }, { Authorization: OAUTH_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string }>;
    expect(body.ok).toBe(true);
    expect(body.data.captureId).toBe("capture-123");
    expect(lastInsertPayload).toMatchObject({
      user_id: "user-oauth",
      status: "pending",
      raw_content: "From the connector",
    });
  });

  it("returns 403 INSUFFICIENT_SCOPE when the OAuth token lacks capture:write", async () => {
    mockResolvedOAuthToken = { userId: "user-oauth", scopes: ["capture:read"], tokenId: "oat-1" };
    const res = await postCapture({ content: "test" }, { Authorization: OAUTH_TOKEN });
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(lastInsertPayload).toBeNull();
  });

  // Contract pin only: this was already a 401 before the dead-token branch existed
  // (it reached session auth and failed there). The two tests below, which add a
  // valid webhook secret, are the ones that prove the dead-token branch itself.
  it("returns 401 NOT_AUTHENTICATED for an expired or revoked OAuth token and inserts nothing", async () => {
    mockResolvedOAuthToken = null;
    const res = await postCapture({ content: "test" }, { Authorization: OAUTH_TOKEN });
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
    expect(lastInsertPayload).toBeNull();
  });

  it("an fb_oat_ value WITHOUT the Bearer scheme is not treated as an OAuth token", async () => {
    // The resolver would return a user for this token if it were consulted with a
    // well-formed header. A malformed header must not reach that outcome.
    const res = await postCapture({ content: "test" }, { Authorization: "fb_oat_testtokenvalue" });
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
    expect(lastInsertPayload).toBeNull();
  });

  it("a dead OAuth token is rejected outright, even alongside a valid webhook secret, and never reaches session auth", async () => {
    mockResolvedOAuthToken = null;
    const { createClient } = await import("@supabase/supabase-js");
    const res = await postCapture(
      { content: "test", secret: "webhook-secret-value" },
      { Authorization: OAUTH_TOKEN }
    );
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
    expect(lastInsertPayload).toBeNull();
    // No Supabase client at all: the token was never handed to auth.getUser().
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("a dead PAT is rejected outright too, matching authenticate()", async () => {
    mockResolvedToken = null;
    mockResolvedOAuthToken = null;
    const { createClient } = await import("@supabase/supabase-js");
    const res = await postCapture({ content: "test", secret: "webhook-secret-value" });
    expect(res.status).toBe(401);
    expect(lastInsertPayload).toBeNull();
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });

  it("rate-limits OAuth captures like PAT captures (429 at the limit)", async () => {
    mockSelectCount = 30;
    const res = await postCapture({ content: "test" }, { Authorization: OAUTH_TOKEN });
    expect(res.status).toBe(429);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(lastInsertPayload).toBeNull();
  });

  it("stores the Idempotency-Key on a first OAuth capture", async () => {
    const res = await postCapture(
      { content: "Hello world" },
      { Authorization: OAUTH_TOKEN, "Idempotency-Key": "oauth-key-1" }
    );
    expect(res.status).toBe(200);
    expect(lastInsertPayload).toMatchObject({ idempotency_key: "oauth-key-1" });
  });

  it("idempotency: a repeated OAuth capture returns the existing id without re-inserting", async () => {
    mockExistingRow = { id: "existing-capture-456" };
    const res = await postCapture(
      { content: "Hello world" },
      { Authorization: OAUTH_TOKEN, "Idempotency-Key": "oauth-key-1" }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string; duplicate?: boolean }>;
    expect(body.data.captureId).toBe("existing-capture-456");
    expect(body.data.duplicate).toBe(true);
    expect(lastInsertPayload).toBeNull();
  });

  it("passes auto_add: false to the process endpoint, so an OAuth capture lands in the inbox", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const { waitUntil } = await import("@vercel/functions");
    const waitUntilSpy = vi.mocked(waitUntil) as MockInstance;

    const res = await postCapture({ content: "Hello world" }, { Authorization: OAUTH_TOKEN });
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
    const processBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as { body: string }).body
    ) as { user_id: string };
    expect(processBody.user_id).toBe("user-oauth");

    fetchSpy.mockRestore();
  });

  it("a PAT still wins when both would resolve, and the OAuth resolver is not consulted", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:write"], tokenId: "token-1" };
    const { resolveOAuthToken } = await import("../_lib/token.js");

    const res = await postCapture({ content: "PAT capture" });
    expect(res.status).toBe(200);
    expect(lastInsertPayload).toMatchObject({ user_id: "user-abc" });
    expect(vi.mocked(resolveOAuthToken)).not.toHaveBeenCalled();
  });
});

// ─── POST capture tests: webhook + session paths still work ───────────────────
//
// The OAuth and dead-token branches sit ahead of these two in the handler. These
// prove legitimate non-token callers are not swallowed by the new branches.

describe("Hono /api/capture — POST capture (webhook and session paths)", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mockResolvedToken = null;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
  });

  async function autoAddSentToProcess(): Promise<{ auto_add: boolean; user_id: string }> {
    const { waitUntil } = await import("@vercel/functions");
    const calls = (vi.mocked(waitUntil) as MockInstance).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    await calls[0][0];
    return JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
  }

  it("a valid webhook secret with no Authorization header still captures, with auto_add on", async () => {
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "From the shortcut", secret: "webhook-secret-value" }),
    });
    expect(res.status).toBe(200);
    expect(lastInsertPayload).toMatchObject({ user_id: "webhook-user-id", raw_content: "From the shortcut" });
    const sent = await autoAddSentToProcess();
    expect(sent).toMatchObject({ auto_add: true, user_id: "webhook-user-id" });
    fetchSpy.mockRestore();
  });

  it("a wrong webhook secret is rejected (401) and inserts nothing", async () => {
    const res = await app.request("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "test", secret: "not-the-secret" }),
    });
    expect(res.status).toBe(401);
    expect(lastInsertPayload).toBeNull();
    fetchSpy.mockRestore();
  });

  it("a Supabase session JWT still captures as that user, with auto_add on", async () => {
    mockSessionUser = { id: "user-session" };
    const res = await postCapture(
      { content: "From the web app" },
      { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.session.jwt" }
    );
    expect(res.status).toBe(200);
    expect(lastInsertPayload).toMatchObject({ user_id: "user-session", raw_content: "From the web app" });
    const sent = await autoAddSentToProcess();
    expect(sent).toMatchObject({ auto_add: true, user_id: "user-session" });
    fetchSpy.mockRestore();
  });
});

// ─── POST /:id/snooze tests ───────────────────────────────────────────────────

describe("Hono /api/capture/:id/snooze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const res = await postSnooze("cap-1", { minutes: 30 }, {});
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postSnooze("cap-1", { minutes: 30 });
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("sets snoozed_until and returns captureId + snoozedUntil", async () => {
    const before = Date.now();
    const res = await postSnooze("cap-1", { minutes: 60 });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string; snoozedUntil: string }>;
    expect(body.ok).toBe(true);
    expect(body.data.captureId).toBe("cap-1");
    const snoozedMs = new Date(body.data.snoozedUntil).getTime();
    expect(snoozedMs).toBeGreaterThan(before + 59 * 60 * 1000);
    expect(snoozedMs).toBeLessThan(before + 61 * 60 * 1000);
  });

  it("clamps minutes below minimum to 1", async () => {
    const before = Date.now();
    const res = await postSnooze("cap-1", { minutes: -5 });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ snoozedUntil: string }>;
    const snoozedMs = new Date(body.data.snoozedUntil).getTime();
    expect(snoozedMs).toBeGreaterThan(before);
    expect(snoozedMs).toBeLessThan(before + 2 * 60 * 1000);
  });

  it("clamps minutes above maximum to 43200", async () => {
    const before = Date.now();
    const res = await postSnooze("cap-1", { minutes: 99999 });
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ snoozedUntil: string }>;
    const snoozedMs = new Date(body.data.snoozedUntil).getTime();
    const maxMs = before + 43200 * 60 * 1000;
    expect(snoozedMs).toBeLessThanOrEqual(maxMs + 1000);
  });

  it("returns 404 NOT_FOUND when capture row not found (wrong user or id)", async () => {
    mockUpdateData = null;
    const res = await postSnooze("nonexistent", { minutes: 30 });
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ─── POST /:id/dismiss tests ──────────────────────────────────────────────────

describe("Hono /api/capture/:id/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("returns 401 when no PAT is provided", async () => {
    mockResolvedToken = null;
    const res = await postDismiss("cap-1", {});
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
  });

  it("returns 403 when PAT lacks capture:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read"], tokenId: "token-1" };
    const res = await postDismiss("cap-1");
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("sets status=dismissed and returns the captureId", async () => {
    const res = await postDismiss("cap-1");
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ captureId: string }>;
    expect(body.ok).toBe(true);
    expect(body.data.captureId).toBe("cap-1");
  });

  it("returns 404 when capture row not found", async () => {
    mockUpdateData = null;
    const res = await postDismiss("nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_FOUND");
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

  it("returns 405 METHOD_NOT_ALLOWED for unsupported methods (e.g. PUT)", async () => {
    const res = await app.request("/api/capture", {
      method: "PUT",
      headers: { Authorization: PAT_TOKEN },
    });
    expect(res.status).toBe(405);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns 401 when no PAT token", async () => {
    mockResolvedToken = null;
    const res = await app.request("/api/capture", { method: "GET" });
    expect(res.status).toBe(401);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("NOT_AUTHENTICATED");
  });

  it("returns 403 when PAT lacks capture:read scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:write"], tokenId: "token-1" };
    const res = await getInbox();
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it("returns items: [], total: 0 when no captures exist", async () => {
    mockQueryResult = { data: [], error: null };
    const res = await getInbox();
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ items: unknown[]; total: number }>;
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ items: [], total: 0 });
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
    const body = await res.json() as OkBody<{ items: unknown[]; total: number }>;
    expect(body.data.items).toHaveLength(2);
    expect(body.data.total).toBe(2);
  });

  it("snooze-visibility: query uses .or() with snoozed_until IS NULL and lte conditions", async () => {
    await getInbox();
    expect(orCallArg).toContain("snoozed_until.is.null");
    expect(orCallArg).toContain("snoozed_until.lte.");
  });

  it("includes the full triage status set — pending alone hid captures the moment AI parsed them", async () => {
    await getInbox();
    expect(inCallArg).toEqual(["pending", "processing", "ready"]);
  });

  it("returns 500 INTERNAL on Supabase query error", async () => {
    mockQueryResult = { data: null, error: { message: "Connection refused" } };
    const res = await getInbox();
    expect(res.status).toBe(500);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INTERNAL");
  });
});
