/**
 * Tests for the card-mutation routes (Phase 4a): POST /api/cards,
 * GET /api/cards/:id, PATCH /api/cards/:id, POST /api/cards/:id/move,
 * POST /api/cards/:id/done.
 *
 * The atomic mutation itself lives in the fb_add_card / fb_mutate_card
 * Postgres functions (exercised on the deployed artifact); here we verify the
 * API contract around them: scope enforcement, validation with hints, the
 * version (CAS) discipline, and the rpc-exception → envelope mapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockBoardState: Record<string, unknown> | null = null;
let mockVersionRows: { id: string; version: number }[] = [];
let mockRpcError: string | null = null;
let mockRpcData: Record<string, unknown> | null = null;
let lastRpc: { fn: string; args: Record<string, unknown> } | null = null;

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
          eq: vi.fn(async () => ({ data: mockVersionRows, error: null })),
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
      lastRpc = { fn, args };
      if (mockRpcError) return { data: null, error: { message: mockRpcError } };
      return { data: mockRpcData ?? args.p_card ?? {}, error: null };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

type OkBody<T> = { ok: true; data: T };
type ErrBody = { ok: false; error: { code: string; message: string; hint?: string } };

const PAT = "Bearer fb_pat_cardtoken";

const COLUMNS = [
  { id: "backlog", title: "Backlog", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 },
  { id: "doing", title: "Doing", icon: "i", color: "c", wipLimit: 2, isTerminal: false, order: 1 },
  { id: "done", title: "Done", icon: "i", color: "c", wipLimit: null, isTerminal: true, order: 2 },
];

function card(id: string, over: Record<string, unknown> = {}) {
  return {
    id, column: "backlog", title: `Card ${id}`, order: 1,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-09T00:00:00.000Z", ...over,
  };
}

function boardState(cards: unknown[]) {
  return {
    cards, columns: COLUMNS, templates: [], settings: {}, tagCategories: [],
    tags: [{ id: "tag-1", name: "roami", color: "#fff", categoryId: "cat" }],
  };
}

function req(method: string, path: string, body?: Record<string, unknown>) {
  const withBody = method !== "GET" && method !== "HEAD";
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: PAT },
    ...(withBody ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = { userId: "user-abc", scopes: ["board:read", "card:write"], tokenId: "t1" };
  mockBoardState = boardState([card("a"), card("b", { column: "doing" })]);
  mockVersionRows = [{ id: "a", version: 3 }, { id: "b", version: 1 }];
  mockRpcError = null;
  mockRpcData = null;
  lastRpc = null;
});

describe("card mutation — auth", () => {
  it.each([
    ["POST", "/api/cards", { title: "x" }],
    ["PATCH", "/api/cards/a", { version: 3, title: "x" }],
    ["POST", "/api/cards/a/move", { version: 3, column: "doing" }],
    ["POST", "/api/cards/a/done", { version: 3 }],
  ])("%s %s requires card:write", async (method, path, body) => {
    mockResolvedToken = { userId: "u", scopes: ["board:read"], tokenId: "t" };
    const res = await req(method, path, body as Record<string, unknown>);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/cards", () => {
  it("creates a card with computed order, history, and tag-name mapping", async () => {
    const res = await req("POST", "/api/cards", {
      title: "New thing", column: "backlog", tags: ["roami"], dueDate: "2026-06-12",
    });
    expect(res.status).toBe(201);
    expect(lastRpc?.fn).toBe("fb_add_card");
    const sent = lastRpc?.args.p_card as Record<string, unknown>;
    expect(sent.title).toBe("New thing");
    expect(sent.order).toBe(2); // existing backlog card has order 1
    expect(sent.tags).toEqual(["tag-1"]); // name → id
    expect(sent.columnHistory).toEqual([
      { from: null, to: "backlog", at: sent.createdAt },
    ]);
    const body = await res.json() as OkBody<{ card: { version: number; tags: string[] } }>;
    expect(body.data.card.version).toBe(1);
    expect(body.data.card.tags).toEqual(["roami"]); // ids resolved back to names
  });

  it("rejects unknown tags with the existing-tags hint", async () => {
    const res = await req("POST", "/api/cards", { title: "x", tags: ["ghost"] });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain('Unknown tag "ghost"');
    expect(body.error.message).toContain("roami");
  });

  it("rejects unknown columns and requires a title", async () => {
    expect((await req("POST", "/api/cards", { title: "x", column: "nope" })).status).toBe(400);
    expect((await req("POST", "/api/cards", {})).status).toBe(400);
  });

  it("sets completedAt when created directly in a terminal column", async () => {
    await req("POST", "/api/cards", { title: "x", column: "done" });
    const sent = lastRpc?.args.p_card as Record<string, unknown>;
    expect(sent.completedAt).toBeTruthy();
  });
});

describe("GET /api/cards/:id", () => {
  it("returns the slim card with its mirror version", async () => {
    const res = await req("GET", "/api/cards/a");
    expect(res.status).toBe(200);
    const body = await res.json() as OkBody<{ card: { id: string; version: number } }>;
    expect(body.data.card.id).toBe("a");
    expect(body.data.card.version).toBe(3);
  });

  it("404s for unknown cards", async () => {
    expect((await req("GET", "/api/cards/ghost")).status).toBe(404);
  });
});

describe("version (CAS) discipline", () => {
  it("rejects mutations that omit version entirely", async () => {
    const res = await req("PATCH", "/api/cards/a", { title: "renamed" });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.message).toContain("version is required");
    expect(body.error.hint).toContain("version: null");
  });

  it("accepts an explicit null to skip the check", async () => {
    mockRpcData = card("a", { title: "renamed" });
    const res = await req("PATCH", "/api/cards/a", { version: null, title: "renamed" });
    expect(res.status).toBe(200);
    expect(lastRpc?.args.p_expected_version).toBeNull();
  });

  it("passes the version through to the CAS and maps STALE_STATE to 409", async () => {
    mockRpcError = "STALE_STATE";
    const res = await req("PATCH", "/api/cards/a", { version: 2, title: "renamed" });
    expect(res.status).toBe(409);
    const body = await res.json() as ErrBody;
    expect(body.error.code).toBe("STALE_STATE");
    expect(body.error.hint).toContain("retry");
    expect(lastRpc?.args.p_expected_version).toBe(2);
  });

  it("maps CARD_NOT_FOUND to 404", async () => {
    mockRpcError = "CARD_NOT_FOUND";
    const res = await req("POST", "/api/cards/ghost/move", { version: 1, column: "doing" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/cards/:id/move and /done", () => {
  it("move sends p_move_to and stamps completedAt only for terminal columns", async () => {
    mockRpcData = card("a", { column: "doing" });
    await req("POST", "/api/cards/a/move", { version: 3, column: "doing" });
    expect(lastRpc?.args.p_move_to).toBe("doing");
    expect((lastRpc?.args.p_patch as Record<string, unknown>).completedAt).toBeUndefined();

    mockRpcData = card("a", { column: "done" });
    await req("POST", "/api/cards/a/move", { version: 3, column: "done" });
    expect((lastRpc?.args.p_patch as Record<string, unknown>).completedAt).toBeTruthy();
  });

  it("move validates the column against the board", async () => {
    const res = await req("POST", "/api/cards/a/move", { version: 3, column: "nope" });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.hint).toContain("backlog");
  });

  it("done targets the first terminal column", async () => {
    mockRpcData = card("a", { column: "done" });
    const res = await req("POST", "/api/cards/a/done", { version: 3 });
    expect(res.status).toBe(200);
    expect(lastRpc?.args.p_move_to).toBe("done");
    expect((lastRpc?.args.p_patch as Record<string, unknown>).completedAt).toBeTruthy();
  });
});

describe("PATCH /api/cards/:id field validation", () => {
  it("builds a clean patch and supports null-clears", async () => {
    mockRpcData = card("a");
    await req("PATCH", "/api/cards/a", {
      version: 3, title: "  Renamed  ", notes: null, dueDate: null, blockedReason: "waiting",
    });
    const patch = lastRpc?.args.p_patch as Record<string, unknown>;
    expect(patch.title).toBe("Renamed");
    expect(patch.notes).toBeNull();
    expect(patch.dueDate).toBeNull();
    expect(patch.blockedReason).toBe("waiting");
  });

  it("rejects an empty patch with the field list", async () => {
    const res = await req("PATCH", "/api/cards/a", { version: 3 });
    expect(res.status).toBe(400);
    const body = await res.json() as ErrBody;
    expect(body.error.hint).toContain("title");
  });
});
