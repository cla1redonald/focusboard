/**
 * Tests for POST /api/cards/batch-move (Phase 5b): whole-plan validation,
 * sequential per-card CAS execution, honest partial results, the 409→per-card
 * STALE_STATE mapping, and scope enforcement.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockBoardState: Record<string, unknown> | null = null;
let mockVersionRows: { id: string; version: number }[] = [];
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcErrorFor: Record<string, string> = {};

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
      rpcCalls.push({ fn, args });
      const failure = rpcErrorFor[args.p_card_id as string];
      if (failure) return { data: null, error: { message: failure } };
      return { data: {}, error: null };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };
type MoveResult = { id: string; title: string; to: string; ok: boolean; version?: number | null; error?: string };

const PAT = "Bearer fb_pat_5btoken";

const COLUMNS = [
  { id: "backlog", title: "Backlog", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 },
  { id: "blocked", title: "Blocked", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 1 },
  { id: "done", title: "Done", icon: "i", color: "c", wipLimit: null, isTerminal: true, order: 2 },
];

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id, column: "backlog", title: `Card ${id}`, order: 1,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-10T00:00:00.000Z", ...over,
  };
}

function post(body: Record<string, unknown>) {
  return app.request("/api/cards/batch-move", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: PAT },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = { userId: "user-abc", scopes: ["board:read", "card:write"], tokenId: "t1" };
  mockBoardState = { cards: [card("a"), card("b"), card("c")], columns: COLUMNS, templates: [], settings: {}, tagCategories: [], tags: [] };
  mockVersionRows = [{ id: "a", version: 3 }, { id: "b", version: 1 }, { id: "c", version: 7 }];
  rpcCalls = [];
  rpcErrorFor = {};
});

describe("batch move — auth + validation", () => {
  it("requires card:write", async () => {
    mockResolvedToken = { userId: "u", scopes: ["board:read"], tokenId: "t" };
    expect((await post({ moves: [{ id: "a", to: "blocked" }] })).status).toBe(403);
  });

  it("validates the whole plan before mutating anything", async () => {
    // unknown column
    const badCol = await post({ moves: [{ id: "a", to: "blocked" }, { id: "b", to: "nope" }] });
    expect(badCol.status).toBe(400);
    expect(((await badCol.json()) as ErrBody).error.hint).toContain("backlog");
    // unknown card
    const badCard = await post({ moves: [{ id: "a", to: "blocked" }, { id: "ghost", to: "blocked" }] });
    expect(badCard.status).toBe(404);
    // NOTHING executed in either case
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects empty, oversized, malformed, and duplicate-id batches", async () => {
    expect((await post({ moves: [] })).status).toBe(400);
    expect((await post({ moves: Array.from({ length: 21 }, (_, i) => ({ id: `x${i}`, to: "blocked" })) })).status).toBe(400);
    expect((await post({ moves: [{ id: "a" }] })).status).toBe(400);
    const dup = await post({ moves: [{ id: "a", to: "blocked" }, { id: "a", to: "done" }] });
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as ErrBody).error.message).toContain("Duplicate");
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("batch move — execution", () => {
  it("moves every card via per-card CAS with execution-time versions", async () => {
    const res = await post({ moves: [{ id: "a", to: "blocked" }, { id: "c", to: "blocked" }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody<{ total: number; moved: number; results: MoveResult[] }>;

    expect(body.data.total).toBe(2);
    expect(body.data.moved).toBe(2);
    expect(rpcCalls.map((r) => r.fn)).toEqual(["fb_mutate_card", "fb_mutate_card"]);
    expect(rpcCalls[0]!.args).toMatchObject({ p_card_id: "a", p_expected_version: 3, p_move_to: "blocked" });
    expect(rpcCalls[1]!.args).toMatchObject({ p_card_id: "c", p_expected_version: 7, p_move_to: "blocked" });
    expect(body.data.results.map((r) => r.version)).toEqual([4, 8]); // bumped
  });

  it("a STALE_STATE on one card does not stop the others (honest partial success)", async () => {
    rpcErrorFor["b"] = "STALE_STATE";
    const res = await post({
      moves: [{ id: "a", to: "blocked" }, { id: "b", to: "blocked" }, { id: "c", to: "blocked" }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as OkBody<{ moved: number; results: MoveResult[] }>;

    expect(body.data.moved).toBe(2);
    expect(rpcCalls).toHaveLength(3); // ALL were attempted
    const byId = Object.fromEntries(body.data.results.map((r) => [r.id, r]));
    expect(byId.a!.ok).toBe(true);
    expect(byId.b).toMatchObject({ ok: false, error: "STALE_STATE" });
    expect(byId.c!.ok).toBe(true);
  });

  it("stamps completedAt only for terminal target columns", async () => {
    await post({ moves: [{ id: "a", to: "done" }, { id: "b", to: "blocked" }] });
    expect((rpcCalls[0]!.args.p_patch as Record<string, unknown>).completedAt).toBeTruthy();
    expect((rpcCalls[1]!.args.p_patch as Record<string, unknown>).completedAt).toBeUndefined();
  });
});
