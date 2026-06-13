/**
 * Tests for the read-only board routes (Phase 2): GET /api/today, /api/cards,
 * /api/wip. Supabase + the token resolver are mocked, but the PROJECTION LOGIC
 * (today.ts, filters.ts) is the REAL code the web app uses — these tests verify
 * the actual semantics, not a mirror of the implementation (the post-hoc-test
 * lesson from the inbox-filter retro).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockBoardState: Record<string, unknown> | null = null;

vi.mock("./token.js", () => ({
  resolveApiToken: vi.fn(async () => mockResolvedToken),
  hasScope: vi.fn((resolved: { scopes: string[] }, scope: string) =>
    resolved.scopes.includes(scope)
  ),
  SCOPES: {
    CAPTURE_READ: "capture:read",
    CAPTURE_WRITE: "capture:write",
    BOARD_READ: "board:read",
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

// Since 4b the API reads non-card state from the app_state blob and CARDS from
// the cards table. The mock serves mockBoardState.cards as table rows so the
// test fixtures keep their one-object shape.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
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
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: mockBoardState ? { state: mockBoardState } : null,
          error: null,
        })),
      };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no user" } })),
    },
  })),
}));

const PAT = "Bearer fb_pat_boardtoken";

const COLUMNS = [
  { id: "backlog", title: "Backlog", icon: "i", color: "c", wipLimit: null, isTerminal: false, order: 0 },
  { id: "doing", title: "Doing", icon: "i", color: "c", wipLimit: 2, isTerminal: false, order: 1 },
  { id: "done", title: "Done", icon: "i", color: "c", wipLimit: null, isTerminal: true, order: 2 },
];

function card(id: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    column: "backlog",
    title: `Card ${id}`,
    order: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...over,
  };
}

function boardState(cards: unknown[]) {
  return {
    cards,
    columns: COLUMNS,
    templates: [],
    settings: {},
    tagCategories: [],
    tags: [{ id: "tag-1", name: "roami", color: "#fff", categoryId: "cat" }],
  };
}

function get(path: string, token = PAT) {
  return app.request(path, { headers: token ? { Authorization: token } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  mockResolvedToken = { userId: "user-abc", scopes: ["board:read"], tokenId: "t1" };
  mockBoardState = boardState([]);
});

describe("board routes — auth", () => {
  it.each(["/api/today", "/api/cards", "/api/wip"])("%s requires board:read (403 without)", async (path) => {
    mockResolvedToken = { userId: "user-abc", scopes: ["capture:read", "capture:write"], tokenId: "t1" };
    const res = await get(path);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
  });

  it.each(["/api/today", "/api/cards", "/api/wip"])("%s returns 401 with no credentials", async (path) => {
    mockResolvedToken = null;
    const res = await get(path, "");
    expect(res.status).toBe(401);
  });

  it("404s with a hint when the user has no board yet", async () => {
    mockBoardState = null;
    const res = await get("/api/today");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.hint).toContain("web app");
  });
});

describe("GET /api/cards", () => {
  it("returns active cards only (archived + terminal-column cards excluded)", async () => {
    mockBoardState = boardState([
      card("a"),
      card("b", { archivedAt: "2026-06-08T00:00:00.000Z" }),
      card("c", { column: "done" }),
    ]);
    const res = await get("/api/cards");
    const body = await res.json() as { data: { total: number; items: { id: string }[] } };
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]!.id).toBe("a");
  });

  it("filters by column and rejects unknown columns with the valid list", async () => {
    mockBoardState = boardState([card("a"), card("b", { column: "doing" })]);
    const okRes = await get("/api/cards?column=doing");
    const okBody = await okRes.json() as { data: { items: { id: string }[] } };
    expect(okBody.data.items.map((i) => i.id)).toEqual(["b"]);

    const badRes = await get("/api/cards?column=nope");
    expect(badRes.status).toBe(400);
    const badBody = await badRes.json() as { error: { code: string; hint?: string } };
    expect(badBody.error.code).toBe("VALIDATION");
    expect(badBody.error.hint).toContain("backlog");
  });

  it("searches with the web's matcher (title, notes, tags, checklist)", async () => {
    mockBoardState = boardState([
      card("a", { title: "Send invoice to ENSEK" }),
      card("b", { notes: "remember the invoice number" }),
      card("c", { checklist: [{ id: "x", text: "attach invoice PDF", done: false }] }),
      card("d", { title: "Unrelated" }),
    ]);
    const res = await get("/api/cards?q=invoice");
    const body = await res.json() as { data: { items: { id: string }[] } };
    expect(body.data.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("resolves tag ids to tag names in the slim card", async () => {
    mockBoardState = boardState([card("a", { tags: ["tag-1", "ghost"] })]);
    const res = await get("/api/cards");
    const body = await res.json() as { data: { items: { tags: string[] }[] } };
    expect(body.data.items[0]!.tags).toEqual(["roami", "ghost"]);
  });

  it("filters by swimlane (cards default to work)", async () => {
    mockBoardState = boardState([card("a"), card("b", { swimlane: "personal" })]);
    const res = await get("/api/cards?swimlane=personal");
    const body = await res.json() as { data: { items: { id: string }[] } };
    expect(body.data.items.map((i) => i.id)).toEqual(["b"]);
  });

  // Regression: notes serialization must match the write-side cap. slimCard
  // once truncated to 280 while the validator accepted 5000, so notes of
  // 281–5000 chars were stored but silently lost on read. See focusboard#55.
  it("returns notes longer than 280 chars in full (not truncated)", async () => {
    const longNotes = "n".repeat(400);
    mockBoardState = boardState([card("a", { notes: longNotes })]);
    const res = await get("/api/cards/a");
    const body = await res.json() as { data: { card: { notes: string } } };
    expect(body.data.card.notes).toBe(longNotes);
    expect(body.data.card.notes.length).toBe(400);
  });

  it("caps notes at the shared NOTES_MAX_LENGTH (5000) on serialization", async () => {
    mockBoardState = boardState([card("a", { notes: "n".repeat(6000) })]);
    const res = await get("/api/cards/a");
    const body = await res.json() as { data: { card: { notes: string } } };
    expect(body.data.card.notes.length).toBe(5000);
  });

  it("returns full >280-char notes on the list endpoint too (same slimCard path)", async () => {
    const longNotes = "n".repeat(400);
    mockBoardState = boardState([card("a", { notes: longNotes })]);
    const res = await get("/api/cards");
    const body = await res.json() as { data: { items: { notes: string }[] } };
    expect(body.data.items[0]!.notes).toBe(longNotes);
  });
});

describe("GET /api/wip", () => {
  it("counts active cards per column and flags atLimit", async () => {
    mockBoardState = boardState([
      card("a", { column: "doing" }),
      card("b", { column: "doing" }),
      card("c"),
      card("d", { column: "done" }), // terminal — not active
    ]);
    const res = await get("/api/wip");
    const body = await res.json() as {
      data: { activeCount: number; columns: { id: string; count: number; atLimit: boolean }[] };
    };
    expect(body.data.activeCount).toBe(3);
    const doing = body.data.columns.find((col) => col.id === "doing")!;
    expect(doing.count).toBe(2);
    expect(doing.atLimit).toBe(true); // limit 2, count 2 — same rule the web uses
    const backlog = body.data.columns.find((col) => col.id === "backlog")!;
    expect(backlog.atLimit).toBe(false); // unlimited
  });
});

describe("GET /api/today", () => {
  it("ranks doing + due-today work via the web's buildTodayPlan", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockBoardState = boardState([
      card("a", { column: "doing", title: "In progress" }),
      card("b", { dueDate: today, title: "Due today" }),
      card("c", { title: "Quiet backlog card", updatedAt: new Date().toISOString() }),
    ]);
    const res = await get("/api/today");
    const body = await res.json() as {
      data: {
        activeCount: number;
        recommendations: { card: { id: string }; reasons: string[] }[];
        attention: { dueToday: { id: string }[] };
      };
    };
    expect(body.data.activeCount).toBe(3);
    expect(body.data.recommendations[0]!.card.id).toBe("a"); // "doing" outweighs due-today
    expect(body.data.recommendations[0]!.reasons).toContain("Already in progress");
    expect(body.data.attention.dueToday.map((i) => i.id)).toEqual(["b"]);
  });

  it("surfaces the daily plan when set for today", async () => {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    mockBoardState = {
      ...boardState([card("main-1", { column: "doing" }), card("sup-1")]),
      dailyPlan: {
        date: dateKey,
        mainCardId: "main-1",
        supportCardIds: ["sup-1"],
        createdAt: "2026-06-09T08:00:00.000Z",
        updatedAt: "2026-06-09T08:00:00.000Z",
      },
    };
    const res = await get("/api/today");
    const body = await res.json() as {
      data: { dailyPlan: { main: { id: string } | null; support: { id: string }[]; plannedCount: number } };
    };
    expect(body.data.dailyPlan.main?.id).toBe("main-1");
    expect(body.data.dailyPlan.support.map((i) => i.id)).toEqual(["sup-1"]);
    expect(body.data.dailyPlan.plannedCount).toBe(2);
  });
});
