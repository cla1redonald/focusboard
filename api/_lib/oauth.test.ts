/**
 * Phase 6.2 — OAuth 2.1 stub tests.
 *
 * Tests cover:
 *   - Well-known metadata endpoint shapes
 *   - Dynamic Client Registration (DCR)
 *   - GET /api/oauth/authorize validation
 *   - POST /api/oauth/authorize: bad password re-renders, good password redirects with code
 *   - POST /api/oauth/token: full PKCE happy path (real S256), wrong verifier → invalid_grant,
 *     code reuse → invalid_grant, refresh rotation (old refresh dies), revoked/expired access
 *     token rejected by authenticate()
 *
 * Uses the same mock pattern as other api tests: mock token.js + @supabase/supabase-js.
 * Tests import { app } (the /api basePath app) for OAuth routes, and { server } for
 * well-known routes (which have no /api prefix).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomBytes } from "crypto";
import { app, server } from "./hono-app.js";

// ── Test state ─────────────────────────────────────────────────────────────────

type OAuthClientRow = { client_id: string; client_name: string | null; redirect_uris: string[] };
type OAuthCodeRow = {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  expires_at: string;
  used_at: string | null;
};
type OAuthTokenRow = {
  id: string;
  client_id: string;
  user_id: string;
  access_token_hash: string;
  refresh_token_hash: string;
  scope: string;
  access_expires_at: string;
  refresh_expires_at?: string;
  revoked_at: string | null;
};

let mockClients: OAuthClientRow[] = [];
let mockCodes: OAuthCodeRow[] = [];
let mockTokens: OAuthTokenRow[] = [];

let mockInsertClientError: string | null = null;
let mockSignInResult: { user: { id: string } | null; error: { message: string } | null } = {
  user: { id: "user-123" },
  error: null,
};

// Used to test OAuth token resolution in authenticate().
let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockResolvedOAuthToken: { userId: string; scopes: string[]; tokenId: string } | null = null;

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("./token.js", () => ({
  resolveApiToken: vi.fn(async () => mockResolvedToken),
  resolveOAuthToken: vi.fn(async () => mockResolvedOAuthToken),
  hasScope: vi.fn((resolved: { scopes: string[] }, scope: string) =>
    resolved.scopes.includes(scope)
  ),
  isOAuthToken: vi.fn((token: string | undefined) =>
    typeof token === "string" && token.startsWith("fb_oat_")
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
  createClient: vi.fn((_url: string, _key: string, opts?: Record<string, unknown>) => {
    // The authorize POST route creates a throwaway anon client with
    // { auth: { persistSession: false } } to call signInWithPassword.
    // Distinguish it by the options object.
    const isAnonClient =
      opts != null &&
      typeof opts === "object" &&
      "auth" in opts;

    if (isAnonClient) {
      return {
        auth: {
          signInWithPassword: vi.fn(async () => ({
            data: { user: mockSignInResult.user },
            error: mockSignInResult.error,
          })),
        },
      };
    }
    // Service-role client used for table operations.
    return {
      from: vi.fn((table: string) => buildTableMock(table)),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "not a session" } })),
      },
    };
  }),
}));

function buildTableMock(table: string) {
  if (table === "oauth_clients") return oauthClientsTableMock();
  if (table === "oauth_codes") return oauthCodesTableMock();
  if (table === "oauth_tokens") return oauthTokensTableMock();
  // Default pass-through for other tables (api_tokens, etc.).
  return {
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
    insert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
        })),
      })),
    })),
  };
}

function oauthClientsTableMock() {
  // The handler calls insert(row).select(...).single() as a fluent chain
  // (not awaited until the end), so each method must return synchronously.
  let pendingNewClient: OAuthClientRow | null = null;

  const insertChain: Record<string, unknown> = {};
  insertChain.select = vi.fn(() => ({
    single: vi.fn(async () => {
      if (mockInsertClientError) return { data: null, error: { message: mockInsertClientError } };
      return { data: pendingNewClient, error: null };
    }),
  }));

  return {
    insert: vi.fn((row: Omit<OAuthClientRow, "client_id">) => {
      if (!mockInsertClientError) {
        pendingNewClient = {
          client_id: "client-" + randomBytes(4).toString("hex"),
          client_name: (row as OAuthClientRow & { client_name?: string | null }).client_name ?? null,
          redirect_uris: row.redirect_uris as unknown as string[],
        };
        mockClients.push(pendingNewClient);
      }
      return insertChain;
    }),
    // SELECT (for authorize GET/POST to validate client)
    select: vi.fn(() => ({
      eq: vi.fn((_field: string, value: string) => ({
        maybeSingle: vi.fn(async () => {
          const found = mockClients.find((c) => c.client_id === value) ?? null;
          return { data: found, error: null };
        }),
      })),
    })),
  };
}

function oauthCodesTableMock() {
  const chain: Record<string, unknown> = {};

  chain.insert = vi.fn(async (row: OAuthCodeRow) => {
    mockCodes.push({ ...row, used_at: null });
    return { error: null };
  });

  // For token endpoint: UPDATE used_at WHERE code_hash + conditions
  let updateConds: { field: string; op: string; value: unknown }[] = [];
  let updatePayload: Record<string, unknown> = {};
  const updateChain: Record<string, unknown> = {};

  updateChain.update = vi.fn((payload: Record<string, unknown>) => {
    updatePayload = payload;
    updateConds = [];
    return updateChain;
  });
  updateChain.eq = vi.fn((field: string, value: unknown) => {
    updateConds.push({ field, op: "eq", value });
    return updateChain;
  });
  updateChain.is = vi.fn((field: string, value: unknown) => {
    updateConds.push({ field, op: "is", value });
    return updateChain;
  });
  updateChain.gt = vi.fn((field: string, value: unknown) => {
    updateConds.push({ field, op: "gt", value });
    return updateChain;
  });
  updateChain.select = vi.fn(() => updateChain);
  updateChain.maybeSingle = vi.fn(async () => {
    const hashCond = updateConds.find((c) => c.field === "code_hash");
    if (!hashCond) return { data: null, error: null };
    const row = mockCodes.find((r) => r.code_hash === hashCond.value);
    if (!row) return { data: null, error: null };
    // used_at IS NULL
    const usedAtCond = updateConds.find((c) => c.op === "is" && c.field === "used_at");
    if (usedAtCond && usedAtCond.value === null && row.used_at !== null) return { data: null, error: null };
    // expires_at > now
    const expiresCond = updateConds.find((c) => c.op === "gt" && c.field === "expires_at");
    if (expiresCond) {
      const now = new Date(expiresCond.value as string);
      if (new Date(row.expires_at) <= now) return { data: null, error: null };
    }
    // Claim it
    row.used_at = updatePayload.used_at as string;
    return {
      data: {
        client_id: row.client_id,
        user_id: row.user_id,
        redirect_uri: row.redirect_uri,
        code_challenge: row.code_challenge,
        scope: row.scope,
      },
      error: null,
    };
  });

  return { ...chain, ...updateChain };
}

function oauthTokensTableMock() {
  const chain: Record<string, unknown> = {};

  chain.insert = vi.fn(async (row: Omit<OAuthTokenRow, "id">) => {
    const newToken: OAuthTokenRow = {
      id: "tok-" + randomBytes(4).toString("hex"),
      ...row,
      revoked_at: null,
    };
    mockTokens.push(newToken);
    return { error: null };
  });

  chain.select = vi.fn(() => {
    const selectChain: Record<string, unknown> = {};
    selectChain.eq = vi.fn((field: string, value: string) => {
      const eqChain: Record<string, unknown> = {};
      eqChain.is = vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          // refresh_token lookup (for refresh grant)
          const found = mockTokens.find((t) => {
            if (field === "refresh_token_hash") return t.refresh_token_hash === value && t.revoked_at === null;
            if (field === "access_token_hash") return t.access_token_hash === value && t.revoked_at === null;
            return false;
          }) ?? null;
          return { data: found, error: null };
        }),
        gt: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            // Expiry-checked lookups: access_token_hash (resolveOAuthToken) OR
            // refresh_token_hash (refresh grant — now enforces refresh_expires_at).
            const now = new Date();
            const found = mockTokens.find((t) => {
              if (t.revoked_at !== null) return false;
              if (field === "access_token_hash") {
                return t.access_token_hash === value && new Date(t.access_expires_at) > now;
              }
              if (field === "refresh_token_hash") {
                const rExp = t.refresh_expires_at ? new Date(t.refresh_expires_at) : new Date(Date.now() + 30 * 86400000);
                return t.refresh_token_hash === value && rExp > now;
              }
              return false;
            }) ?? null;
            return { data: found, error: null };
          }),
        })),
      }));
      return eqChain;
    });
    return selectChain;
  });

  // UPDATE (for refresh token rotation — revoke old)
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    const updateChain: Record<string, unknown> = {};
    updateChain.eq = vi.fn((_field: string, value: string) => {
      // Apply the revoke
      const token = mockTokens.find((t) => t.id === value);
      if (token && payload.revoked_at) token.revoked_at = payload.revoked_at as string;
      return Promise.resolve({ error: null });
    });
    return updateChain;
  });

  return chain;
}

beforeEach(() => {
  mockClients = [];
  mockCodes = [];
  mockTokens = [];
  mockInsertClientError = null;
  mockSignInResult = { user: { id: "user-123" }, error: null };
  mockResolvedToken = null;
  mockResolvedOAuthToken = null;
  // Set env vars that getServiceClient() and the anon client factory require.
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_ANON_KEY = "anon-key";
});

// ── Well-known metadata ────────────────────────────────────────────────────────

describe("GET /.well-known/oauth-authorization-server", () => {
  it("returns metadata with correct endpoints", async () => {
    const res = await server.request("/.well-known/oauth-authorization-server", {
      headers: { host: "focusboard.vercel.app" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.issuer).toBe("https://focusboard.vercel.app");
    expect(body.authorization_endpoint).toBe("https://focusboard.vercel.app/api/oauth/authorize");
    expect(body.token_endpoint).toBe("https://focusboard.vercel.app/api/oauth/token");
    expect(body.registration_endpoint).toBe("https://focusboard.vercel.app/api/oauth/register");
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(Array.isArray(body.scopes_supported)).toBe(true);
    expect((body.scopes_supported as string[]).length).toBeGreaterThan(0);
  });
});

describe("GET /.well-known/oauth-protected-resource", () => {
  it("returns resource metadata", async () => {
    const res = await server.request("/.well-known/oauth-protected-resource", {
      headers: { host: "focusboard.vercel.app" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.resource).toBe("https://focusboard.vercel.app/api/mcp");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
  });

  it("path-suffixed variant also returns resource metadata", async () => {
    const res = await server.request("/.well-known/oauth-protected-resource/mcp", {
      headers: { host: "focusboard.vercel.app" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.resource).toBe("string");
  });
});

// ── DCR (Dynamic Client Registration) ─────────────────────────────────────────

describe("POST /api/oauth/register", () => {
  it("registers a client with valid redirect_uris", async () => {
    const res = await app.request("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://claude.ai/oauth/callback"],
        client_name: "Test Client",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  it("allows http://localhost for tooling", async () => {
    const res = await app.request("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost:12345/callback"] }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects empty redirect_uris array", async () => {
    const res = await app.request("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects non-https redirect_uri (not localhost)", async () => {
    const res = await app.request("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.com/callback"] }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/oauth/authorize ───────────────────────────────────────────────────

describe("GET /api/oauth/authorize", () => {
  const CLIENT_ID = "client-test-123";
  const REDIRECT_URI = "https://example.com/callback";

  beforeEach(() => {
    // Pre-seed a client so the authorize route finds it.
    mockClients.push({ client_id: CLIENT_ID, client_name: null, redirect_uris: [REDIRECT_URI] });
  });

  it("returns 400 (no redirect) for unknown client_id", async () => {
    const res = await app.request(
      "/api/oauth/authorize?response_type=code&client_id=unknown&redirect_uri=https://example.com&code_challenge=abc&code_challenge_method=S256"
    );
    expect(res.status).toBe(400);
    // Must NOT redirect — returning error as text per RFC 6749 §4.1.2.1
    expect(res.headers.get("location")).toBeNull();
  });

  it("returns 400 (no redirect) for unregistered redirect_uri", async () => {
    const res = await app.request(
      `/api/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=https://evil.com/callback&code_challenge=abc&code_challenge_method=S256`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("renders the login form for valid params", async () => {
    const res = await app.request(
      `/api/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=abc&code_challenge_method=S256`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain("FocusBoard");
  });

  it("the login page forbids framing (clickjacking defense)", async () => {
    const res = await app.request(
      `/api/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=abc&code_challenge_method=S256`
    );
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("missing code_challenge redirects with error (not 400)", async () => {
    const res = await app.request(
      `/api/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    );
    // Should redirect to redirect_uri with error=invalid_request
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("error=invalid_request");
  });
});

// ── POST /api/oauth/authorize ──────────────────────────────────────────────────

describe("POST /api/oauth/authorize", () => {
  const CLIENT_ID = "client-test-456";
  const REDIRECT_URI = "https://example.com/callback";

  beforeEach(() => {
    mockClients.push({ client_id: CLIENT_ID, client_name: null, redirect_uris: [REDIRECT_URI] });
  });

  const baseBody = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: "test-state",
      code_challenge: "test-challenge",
      scope: "capture:read",
      email: "claire@example.com",
      password: "secret",
      ...extra,
    });
    return params.toString();
  };

  it("re-renders the form on bad credentials (HTTP 200, not redirect)", async () => {
    mockSignInResult = { user: null, error: { message: "Invalid login credentials" } };
    const res = await app.request("/api/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: baseBody(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Invalid email or password");
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects with code on good credentials", async () => {
    mockSignInResult = { user: { id: "user-abc" }, error: null };
    const res = await app.request("/api/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: baseBody(),
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("code=");
    expect(loc).toContain("state=test-state");
    // Code should have been stored.
    expect(mockCodes.length).toBe(1);
    expect(mockCodes[0].client_id).toBe(CLIENT_ID);
  });
});

// ── POST /api/oauth/token ──────────────────────────────────────────────────────

describe("POST /api/oauth/token — authorization_code grant (PKCE)", () => {
  const CLIENT_ID = "client-token-test";
  const USER_ID = "user-token-test";
  const REDIRECT_URI = "https://example.com/callback";

  /**
   * Create a real S256 PKCE pair and seed a code row.
   * Returns the code verifier (plaintext) for use in the token request.
   */
  function seedCodeRow(overrides: Partial<OAuthCodeRow> = {}): { codeVerifier: string; codeRaw: string } {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const codeRaw = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(codeRaw).digest("hex");

    mockCodes.push({
      code_hash: codeHash,
      client_id: CLIENT_ID,
      user_id: USER_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      scope: "capture:read capture:write",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      used_at: null,
      ...overrides,
    });

    return { codeVerifier, codeRaw };
  }

  it("happy path: returns access_token, refresh_token, scope", async () => {
    const { codeVerifier, codeRaw } = seedCodeRow();
    const res = await app.request("/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: codeRaw,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        client_id: CLIENT_ID,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.access_token).toBe("string");
    expect((body.access_token as string).startsWith("fb_oat_")).toBe(true);
    expect(typeof body.refresh_token).toBe("string");
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe("capture:read capture:write");
    // Token rows stored.
    expect(mockTokens.length).toBe(1);
  });

  it("wrong code_verifier → invalid_grant", async () => {
    const { codeRaw } = seedCodeRow();
    const res = await app.request("/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: codeRaw,
        redirect_uri: REDIRECT_URI,
        code_verifier: "wrong-verifier-definitely-not-right",
        client_id: CLIENT_ID,
      }).toString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_grant");
  });

  it("code reuse → invalid_grant (used_at set after first use)", async () => {
    const { codeVerifier, codeRaw } = seedCodeRow();
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: codeRaw,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
    }).toString();
    const opts = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params };

    // First use — succeeds.
    const first = await app.request("/api/oauth/token", opts);
    expect(first.status).toBe(200);

    // Second use — code already used.
    const second = await app.request("/api/oauth/token", opts);
    expect(second.status).toBe(400);
    const body = await second.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_grant");
  });
});

describe("POST /api/oauth/token — refresh_token rotation", () => {
  const CLIENT_ID = "client-refresh-test";
  const USER_ID = "user-refresh-test";

  function seedTokenRow() {
    const refreshToken = "fb_ort_" + randomBytes(32).toString("base64url");
    const accessToken = "fb_oat_" + randomBytes(32).toString("base64url");
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");
    const accessHash = createHash("sha256").update(accessToken).digest("hex");
    const row: OAuthTokenRow = {
      id: "tok-" + randomBytes(4).toString("hex"),
      client_id: CLIENT_ID,
      user_id: USER_ID,
      access_token_hash: accessHash,
      refresh_token_hash: refreshHash,
      scope: "board:read",
      access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      revoked_at: null,
    };
    mockTokens.push(row);
    return { refreshToken, rowId: row.id };
  }

  it("rotation: returns new token pair and revokes the old refresh token", async () => {
    const { refreshToken, rowId } = seedTokenRow();
    const res = await app.request("/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    // New token pair should differ from original.
    expect(body.refresh_token).not.toBe(refreshToken);
    // Old token row should be revoked.
    const oldRow = mockTokens.find((t) => t.id === rowId);
    expect(oldRow?.revoked_at).not.toBeNull();
    // New row should be present.
    expect(mockTokens.length).toBe(2);
  });

  it("revoked refresh token → invalid_grant", async () => {
    const { refreshToken, rowId } = seedTokenRow();
    // Revoke it manually.
    const row = mockTokens.find((t) => t.id === rowId);
    if (row) row.revoked_at = new Date().toISOString();

    const res = await app.request("/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("invalid_grant");
  });
});

describe("POST /api/oauth/token — unsupported grant", () => {
  it("returns unsupported_grant_type", async () => {
    const res = await app.request("/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("unsupported_grant_type");
  });
});

// ── OAuth token auth: revoked/expired access token rejected ───────────────────

describe("authenticate() — OAuth token rejection", () => {
  it("rejects an expired/revoked OAuth token on a protected route", async () => {
    // mockResolvedOAuthToken is null → resolveOAuthToken returns null → 401.
    mockResolvedOAuthToken = null;
    const res = await app.request("/api/capture", {
      headers: { authorization: "Bearer fb_oat_expired_token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid OAuth token on a protected route", async () => {
    mockResolvedOAuthToken = {
      userId: "user-oauth",
      scopes: ["capture:read"],
      tokenId: "tok-oauth",
    };
    // isOAuthToken mock returns true for fb_oat_ prefix — but we need the
    // auth-middleware to pick up the oauth path. The mock resolveOAuthToken
    // is returned from token.js mock. We need the isOAuthToken check to fire.
    // auth-middleware checks isPat first (fb_pat_) — our token starts with fb_oat_,
    // so it falls to the isOAuthToken branch.
    const res = await app.request("/api/capture", {
      headers: { authorization: "Bearer fb_oat_valid_token" },
    });
    // The route needs capture:read; the mock principal has it.
    // We can't fully test the DB query without the full Supabase mock, but
    // the middleware should call resolveOAuthToken and set the principal.
    // Since we have a mock that returns a valid principal, we expect non-401.
    // (We'll get 500 if the Supabase capture_queue query fails, but not 401.)
    expect(res.status).not.toBe(401);
  });
});
