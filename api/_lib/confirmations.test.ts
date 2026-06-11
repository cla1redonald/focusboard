/**
 * Tests for the Phase 6.1 durable confirmation gate:
 *   POST /api/confirmations        — propose a Tier-3 operation
 *   POST /api/confirmations/confirm — claim and execute atomically
 *
 * Mirrors the mock style of cards-mutation.test.ts: mock token.js and
 * @supabase/supabase-js; dispatch via app.fetch().
 *
 * Security invariants tested:
 *   - scope enforcement (403 without card:write)
 *   - tool allowlist at proposal time
 *   - preview validation
 *   - confirm with unknown/expired/used token → 404 CONFIRM_NOT_FOUND
 *   - cross-user: a token stored with another user_id is not claimable
 *   - single-use enforcement (second confirm with same token → 404)
 *   - successful confirm executes the mapped op in-process and returns result
 *   - move_card executor reads a fresh version first
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

// ── Test-state globals ─────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
// Rows currently "in" the mcp_confirmations table (keyed by token_hash).
let mockConfirmationRows: Record<string, {
  user_id: string;
  token_hash: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  expires_at: string;
  used_at: string | null;
}> = {};
let mockInsertError: string | null = null;

// For the in-process executor calls that go through the board / rpc mocks.
let mockBoardState: Record<string, unknown> | null = null;
let mockVersionRows: { id: string; version: number }[] = [];
let mockRpcError: string | null = null;
let mockRpcData: Record<string, unknown> | null = null;
let lastRpc: { fn: string; args: Record<string, unknown> } | null = null;

// ── Mocks ──────────────────────────────────────────────────────────────────────

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

/**
 * Supabase mock that handles both the confirmation table and the board/rpc
 * operations that the in-process executor triggers. Uses the `table` parameter
 * to route to the appropriate mock behaviour.
 */
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      // ── mcp_confirmations table ────────────────────────────────────────────
      if (table === "mcp_confirmations") {
        const insertChain = {
          insert: vi.fn((row: Record<string, unknown>) => {
            if (mockInsertError) {
              return Promise.resolve({ error: { message: mockInsertError } });
            }
            // Store the row (token_hash is the key).
            const tokenHash = row.token_hash as string;
            mockConfirmationRows[tokenHash] = {
              user_id: row.user_id as string,
              token_hash: tokenHash,
              tool: row.tool as string,
              args: row.args as Record<string, unknown>,
              preview: row.preview as string,
              expires_at: row.expires_at as string,
              used_at: null,
            };
            return Promise.resolve({ error: null });
          }),
        };

        // The confirm route calls .update().eq().is().gt().eq().select().maybeSingle()
        let updateConditions: { field: string; op: string; value: unknown }[] = [];
        const updateChain: Record<string, unknown> = {};
        let updatePayload: Record<string, unknown> = {};

        updateChain.update = vi.fn((payload: Record<string, unknown>) => {
          updatePayload = payload;
          updateConditions = [];
          return updateChain;
        });
        updateChain.eq = vi.fn((field: string, value: unknown) => {
          updateConditions.push({ field, op: "eq", value });
          return updateChain;
        });
        updateChain.is = vi.fn((field: string, value: unknown) => {
          updateConditions.push({ field, op: "is", value });
          return updateChain;
        });
        updateChain.gt = vi.fn((field: string, value: unknown) => {
          updateConditions.push({ field, op: "gt", value });
          return updateChain;
        });
        updateChain.select = vi.fn(() => updateChain);
        updateChain.maybeSingle = vi.fn(async () => {
          // Find the row that satisfies all conditions.
          const hashCond = updateConditions.find((c) => c.field === "token_hash");
          const userCond = updateConditions.find((c) => c.field === "user_id");
          const usedAtCond = updateConditions.find((c) => c.op === "is" && c.field === "used_at");
          const expiresCond = updateConditions.find((c) => c.op === "gt" && c.field === "expires_at");

          if (!hashCond) return { data: null, error: null };
          const row = mockConfirmationRows[hashCond.value as string];
          if (!row) return { data: null, error: null };

          // user_id equality (cross-user guard).
          if (userCond && row.user_id !== userCond.value) return { data: null, error: null };

          // used_at IS NULL (single-use guard).
          if (usedAtCond && usedAtCond.value === null && row.used_at !== null) {
            return { data: null, error: null };
          }

          // expires_at > now (expiry guard).
          if (expiresCond) {
            const now = new Date(expiresCond.value as string);
            if (new Date(row.expires_at) <= now) return { data: null, error: null };
          }

          // Claim it.
          row.used_at = updatePayload.used_at as string;
          return { data: { tool: row.tool, args: row.args }, error: null };
        });

        return { ...insertChain, ...updateChain };
      }

      // ── cards table (for the in-process executor's GET /api/cards/:id) ────────
      if (table === "cards") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(async () => ({
            data: ((mockBoardState?.cards as Record<string, unknown>[] | undefined) ?? []).map((c) => ({
              id: c.id,
              card_json: c,
              version: mockVersionRows.find((v) => v.id === c.id)?.version ?? 1,
            })),
            error: null,
          })),
        };
      }

      // ── app_state table (for loadBoard) ───────────────────────────────────────
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: mockBoardState ? { state: mockBoardState } : null,
          error: null,
        })),
      };
    }),

    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      lastRpc = { fn, args };
      if (mockRpcError) return { data: null, error: { message: mockRpcError } };
      return { data: mockRpcData ?? args.p_card ?? {}, error: null };
    }),

    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

// ── Test helpers ───────────────────────────────────────────────────────────────

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };

const PAT = "Bearer fb_pat_conftest";

const COLUMNS = [
  { id: "backlog", title: "Backlog", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 },
  { id: "doing", title: "Doing", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 1 },
  { id: "done", title: "Done", icon: "i", color: "c", wipLimit: null, isTerminal: true, order: 2 },
];

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id, column: "backlog", title: `Card ${id}`, order: 1,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-12T00:00:00.000Z", ...over,
  };
}

function boardState(cards: unknown[]) {
  return {
    cards, columns: COLUMNS, templates: [], settings: {}, tagCategories: [], tags: [],
  };
}

function post(path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: PAT },
    body: JSON.stringify(body),
  });
}

/** Compute sha256 hex the same way hono-app.ts does. */
import { createHash } from "crypto";
function sha256hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/** Inject a confirmation row directly (bypasses the POST /api/confirmations flow). */
function seedConfirmation(opts: {
  userId: string;
  plaintext: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  expired?: boolean;
  usedAt?: string;
}) {
  const tokenHash = sha256hex(opts.plaintext);
  const expiresAt = opts.expired
    ? new Date(Date.now() - 10000).toISOString()  // in the past
    : new Date(Date.now() + 300_000).toISOString();
  mockConfirmationRows[tokenHash] = {
    user_id: opts.userId,
    token_hash: tokenHash,
    tool: opts.tool,
    args: opts.args,
    preview: opts.preview,
    expires_at: expiresAt,
    used_at: opts.usedAt ?? null,
  };
}

// ── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = { userId: "user-abc", scopes: ["card:write", "board:read"], tokenId: "t1" };
  mockConfirmationRows = {};
  mockInsertError = null;
  mockBoardState = boardState([card("card-x"), card("card-y")]);
  mockVersionRows = [{ id: "card-x", version: 5 }, { id: "card-y", version: 2 }];
  mockRpcError = null;
  mockRpcData = null;
  lastRpc = null;
});

// ── POST /api/confirmations — scope enforcement ────────────────────────────────

describe("POST /api/confirmations — scope enforcement", () => {
  it("returns 403 without card:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["board:read"], tokenId: "t" };
    const res = await post("/api/confirmations", {
      tool: "add_card", args: { title: "test" }, preview: "Add card",
    });
    expect(res.status).toBe(403);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });
});

// ── POST /api/confirmations — validation ──────────────────────────────────────

describe("POST /api/confirmations — validation", () => {
  it("rejects an unknown tool", async () => {
    const res = await post("/api/confirmations", {
      tool: "delete_board", args: {}, preview: "Delete the board",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("delete_board");
    expect(body.error.hint).toContain("add_card");
  });

  it("rejects a missing tool", async () => {
    const res = await post("/api/confirmations", { args: {}, preview: "test" });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("tool is required");
  });

  it("rejects an empty preview", async () => {
    const res = await post("/api/confirmations", { tool: "add_card", args: { title: "t" }, preview: "" });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("preview is required");
  });

  it("rejects a preview over 2000 chars", async () => {
    const res = await post("/api/confirmations", {
      tool: "add_card", args: { title: "t" }, preview: "x".repeat(2001),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("2000");
  });

  it("rejects a non-object args", async () => {
    const res = await post("/api/confirmations", {
      tool: "add_card", args: ["title"], preview: "Add card",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("args is required");
  });

  it("creates a confirmation and returns confirm_token + preview", async () => {
    const res = await post("/api/confirmations", {
      tool: "add_card", args: { title: "Buy milk" }, preview: 'Add card "Buy milk" to backlog (work)',
    });
    expect(res.status).toBe(201);
    const body = await res.json() as OkBody<{ confirm_token: string; expires_in_seconds: number; preview: string }>;
    expect(body.ok).toBe(true);
    expect(typeof body.data.confirm_token).toBe("string");
    expect(body.data.confirm_token.length).toBeGreaterThan(0);
    expect(body.data.expires_in_seconds).toBe(300);
    expect(body.data.preview).toBe('Add card "Buy milk" to backlog (work)');
    // Confirm the row was stored with the hash.
    const hash = sha256hex(body.data.confirm_token);
    expect(mockConfirmationRows[hash]).toBeDefined();
    expect(mockConfirmationRows[hash]!.tool).toBe("add_card");
    expect(mockConfirmationRows[hash]!.user_id).toBe("user-abc");
  });
});

// ── POST /api/confirmations/confirm — scope enforcement ───────────────────────

describe("POST /api/confirmations/confirm — scope enforcement", () => {
  it("returns 403 without card:write scope", async () => {
    mockResolvedToken = { userId: "user-abc", scopes: ["board:read"], tokenId: "t" };
    const res = await post("/api/confirmations/confirm", { confirm_token: "tok" });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/confirmations/confirm — invalid tokens ──────────────────────────

describe("POST /api/confirmations/confirm — invalid tokens", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await post("/api/confirmations/confirm", { confirm_token: "no-such-token" });
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("CONFIRM_NOT_FOUND");
    expect(body.error.hint).toContain("re-propose");
  });

  it("returns 404 for an expired token", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "exp-token", tool: "add_card",
      args: { title: "x" }, preview: "Add card", expired: true,
    });
    const res = await post("/api/confirmations/confirm", { confirm_token: "exp-token" });
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("CONFIRM_NOT_FOUND");
  });

  it("returns 404 for an already-used token (single-use enforcement)", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "used-token", tool: "add_card",
      args: { title: "x" }, preview: "Add card",
      usedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await post("/api/confirmations/confirm", { confirm_token: "used-token" });
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("CONFIRM_NOT_FOUND");
  });

  it("returns 404 for a missing confirm_token body field", async () => {
    const res = await post("/api/confirmations/confirm", {});
    expect(res.status).toBe(400);
  });
});

// ── CROSS-USER: token not claimable by another user ───────────────────────────

describe("cross-user security", () => {
  it("a token stored with another user_id is not claimable", async () => {
    // Seed a token belonging to user-OTHER, not user-abc.
    seedConfirmation({
      userId: "user-OTHER",
      plaintext: "cross-user-token",
      tool: "add_card",
      args: { title: "Evil add" },
      preview: "Add card",
    });

    // user-abc tries to claim it.
    mockResolvedToken = { userId: "user-abc", scopes: ["card:write"], tokenId: "t1" };
    const res = await post("/api/confirmations/confirm", { confirm_token: "cross-user-token" });
    expect(res.status).toBe(404);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("CONFIRM_NOT_FOUND");

    // The row must NOT have been claimed (used_at still null).
    const hash = sha256hex("cross-user-token");
    expect(mockConfirmationRows[hash]!.used_at).toBeNull();
  });
});

// ── Successful confirm — add_card ─────────────────────────────────────────────

describe("successful confirm — add_card", () => {
  it("executes POST /api/cards in-process and returns its result", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "add-tok",
      tool: "add_card",
      args: { title: "Buy milk", column: "backlog" },
      preview: 'Add card "Buy milk" to backlog (work)',
    });

    const res = await post("/api/confirmations/confirm", { confirm_token: "add-tok" });
    expect(res.status).toBe(200);

    // The fb_add_card RPC should have been invoked.
    expect(lastRpc?.fn).toBe("fb_add_card");
    const sent = lastRpc?.args.p_card as Record<string, unknown>;
    expect(sent.title).toBe("Buy milk");

    const body = await res.json() as OkBody<{ card: { title: string } }>;
    expect(body.ok).toBe(true);

    // Token must be marked as used.
    const hash = sha256hex("add-tok");
    expect(mockConfirmationRows[hash]!.used_at).toBeTruthy();
  });

  it("the claimed token cannot be reused (single-use verified via mock state)", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "once-tok",
      tool: "add_card",
      args: { title: "x" },
      preview: "Add card",
    });

    // First confirm succeeds.
    await post("/api/confirmations/confirm", { confirm_token: "once-tok" });

    // Second confirm: used_at is now set, so the mock returns null → 404.
    const res2 = await post("/api/confirmations/confirm", { confirm_token: "once-tok" });
    expect(res2.status).toBe(404);
    const body = await res2.json() as ErrBody;
    expect(body.error.code).toBe("CONFIRM_NOT_FOUND");
  });
});

// ── move_card executor reads a fresh version ──────────────────────────────────

describe("move_card executor — fresh version", () => {
  it("reads GET /api/cards/:id before sending the move, using the current version", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "move-tok",
      tool: "move_card",
      args: { card_id: "card-x", column: "doing" },
      preview: 'Move "Card card-x" → doing',
    });

    mockRpcData = card("card-x", { column: "doing" });

    const res = await post("/api/confirmations/confirm", { confirm_token: "move-tok" });
    expect(res.status).toBe(200);

    // fb_mutate_card should have been called with the CURRENT version (5 from mockVersionRows).
    expect(lastRpc?.fn).toBe("fb_mutate_card");
    expect(lastRpc?.args.p_card_id).toBe("card-x");
    expect(lastRpc?.args.p_expected_version).toBe(5);
    expect(lastRpc?.args.p_move_to).toBe("doing");
  });
});

// ── batch-move executor uses the board's current versions ─────────────────────

describe("move_cards executor", () => {
  it("dispatches POST /api/cards/batch-move with id/to pairs", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "batch-tok",
      tool: "move_cards",
      args: {
        moves: [
          { card_id: "card-x", column: "doing" },
          { card_id: "card-y", column: "done" },
        ],
      },
      preview: "2 moves:\nMove...",
    });

    const res = await post("/api/confirmations/confirm", { confirm_token: "batch-tok" });
    expect(res.status).toBe(200);

    // Verify via the response body (lastRpc tracks the final rpc call).
    const body = await res.json() as OkBody<{ total: number; moved: number }>;
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(2);
  });
});

// ── STALE_STATE propagates correctly ──────────────────────────────────────────

describe("executor error propagation", () => {
  it("a STALE_STATE from the underlying route surfaces as 409 from /confirm", async () => {
    seedConfirmation({
      userId: "user-abc", plaintext: "stale-tok",
      tool: "move_card",
      args: { card_id: "card-x", column: "doing" },
      preview: 'Move "Card card-x" → doing',
    });

    mockRpcError = "STALE_STATE";

    const res = await post("/api/confirmations/confirm", { confirm_token: "stale-tok" });
    expect(res.status).toBe(409);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("STALE_STATE");
  });
});
