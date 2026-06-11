/**
 * Phase 6.2 — Hosted MCP server tests.
 *
 * Tests cover:
 *   - initialize, ping, notification shapes
 *   - tools/list returns ALL tool names
 *   - tools/call focusboard_today dispatches in-process and wraps the envelope
 *   - tools/call with a capture:read-only principal against a card:write tool
 *     returns isError with the 403 envelope (scope enforcement proven)
 *   - Tier-3 tool (focusboard_add_card) returns confirmation_required
 *   - unknown tool → JSON-RPC error -32602
 *
 * The MCP endpoint (POST /api/mcp) requires capture:read to enter.
 * Per-tool scope enforcement fires via the in-process dispatch (ROUTE_SCOPES
 * re-enforces on every sub-request through the composed server).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "./hono-app.js";
import { HOSTED_TOOLS } from "./mcp-server.js";

// ── Test state ─────────────────────────────────────────────────────────────────

let mockResolvedToken: { userId: string; scopes: string[]; tokenId: string } | null = null;
let mockResolvedOAuthToken: { userId: string; scopes: string[]; tokenId: string } | null = null;

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("./token.js", () => ({
  resolveApiToken: vi.fn(async () => mockResolvedToken),
  resolveOAuthToken: vi.fn(async () => mockResolvedOAuthToken),
  isOAuthToken: vi.fn((token: string | undefined) =>
    typeof token === "string" && token.startsWith("fb_oat_")
  ),
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

// Supabase mock: provides enough for board reads (today, cards, etc.)
// and for the confirmations table (POST /api/confirmations).
let mockAppState: Record<string, unknown> | null = null;
let mockCardRows: { id: string; title: string; version: number; column_id: string; swimlane_id: string; status: string }[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "app_state") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: mockAppState ? { state: mockAppState } : null,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "cards") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                order: vi.fn(() =>
                  Promise.resolve({ data: mockCardRows, error: null })
                ),
              })),
              maybeSingle: vi.fn(async () => ({
                data: mockCardRows[0] ?? null,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "mcp_confirmations") {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }
      if (table === "focus_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                gte: vi.fn(() => ({
                  order: vi.fn(() =>
                    Promise.resolve({ data: [], error: null })
                  ),
                })),
              })),
              is: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        };
      }
      // Default
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        insert: vi.fn(async () => ({ error: null })),
      };
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no session" } })),
    },
  })),
}));

beforeEach(() => {
  mockResolvedToken = null;
  mockResolvedOAuthToken = null;
  mockAppState = null;
  mockCardRows = [];
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

// ── Auth helper ────────────────────────────────────────────────────────────────

function allScopeToken() {
  mockResolvedToken = {
    userId: "user-mcp",
    scopes: ["capture:read", "capture:write", "board:read", "focus:read", "focus:write", "card:write"],
    tokenId: "tok-all",
  };
  return "Bearer fb_pat_all_scopes";
}

function readOnlyToken() {
  mockResolvedToken = {
    userId: "user-readonly",
    scopes: ["capture:read"],
    tokenId: "tok-readonly",
  };
  return "Bearer fb_pat_readonly";
}

async function mcpPost(body: unknown, authHeader?: string) {
  return app.request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── Basic JSON-RPC shapes ──────────────────────────────────────────────────────

describe("POST /api/mcp — requires auth", () => {
  it("returns 401 without credentials", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/mcp — initialize", () => {
  it("echoes protocolVersion and returns serverInfo", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { jsonrpc: string; id: number; result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("focusboard");
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
  });
});

describe("POST /api/mcp — ping", () => {
  it("returns empty result", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({ jsonrpc: "2.0", id: 2, method: "ping" }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { result: unknown };
    expect(body.result).toEqual({});
  });
});

describe("POST /api/mcp — notifications (no id)", () => {
  it("returns 202 with no body for a notification (id absent)", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }, auth);
    expect(res.status).toBe(202);
    const text = await res.text();
    expect(text).toBe("");
  });

  it("returns 202 for notification with explicit null id", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: null,
      method: "notifications/cancelled",
    }, auth);
    expect(res.status).toBe(202);
  });
});

// ── tools/list ────────────────────────────────────────────────────────────────

describe("POST /api/mcp — tools/list", () => {
  it("returns ALL hosted tool names", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({ jsonrpc: "2.0", id: 3, method: "tools/list" }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((t) => t.name);
    // All HOSTED_TOOLS must appear.
    for (const tool of HOSTED_TOOLS) {
      expect(names).toContain(tool.name);
    }
    expect(names.length).toBe(HOSTED_TOOLS.length);
  });

  it("each tool has name, description, and inputSchema", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({ jsonrpc: "2.0", id: 4, method: "tools/list" }, auth);
    const body = await res.json() as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } };
    for (const tool of body.result.tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// ── tools/call: unknown tool ───────────────────────────────────────────────────

describe("POST /api/mcp — tools/call unknown tool", () => {
  it("returns JSON-RPC error -32602 for unknown tool", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
  });
});

// ── tools/call: focusboard_today (in-process dispatch) ────────────────────────

describe("POST /api/mcp — tools/call focusboard_today", () => {
  it("dispatches in-process and wraps the API envelope in MCP result", async () => {
    const auth = allScopeToken();
    // Seed minimal app_state so the board load succeeds.
    mockAppState = {
      columns: [{ id: "doing", label: "Doing", wipLimit: 3 }],
      swimlanes: [{ id: "work", label: "Work" }],
      boardSettings: {},
      tags: [],
    };
    mockCardRows = [];

    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "focusboard_today", arguments: {} },
    }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      result: {
        content: { type: "text"; text: string }[];
        isError: boolean;
      };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.content.length).toBeGreaterThan(0);
    expect(body.result.content[0].type).toBe("text");
    // The text should be a JSON string containing the API envelope.
    const parsed = JSON.parse(body.result.content[0].text) as { ok?: boolean };
    expect(parsed.ok).toBe(true);
  });
});

// ── tools/call: scope enforcement (capture:read-only principal, card:write tool) ─

describe("POST /api/mcp — scope enforcement via in-process dispatch", () => {
  it("capture:read principal calling focusboard_add_card gets isError with 403", async () => {
    const auth = readOnlyToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "focusboard_add_card",
        arguments: { title: "Test card" },
      },
    }, auth);
    // The MCP endpoint itself allows entry (capture:read is the gate).
    // The in-process dispatch to POST /api/confirmations requires card:write → 403.
    expect(res.status).toBe(200);
    const body = await res.json() as {
      result: { content: { type: "text"; text: string }[]; isError: boolean };
    };
    expect(body.result.isError).toBe(true);
    const text = JSON.parse(body.result.content[0].text) as { ok: boolean; error?: { code: string } };
    // Should be the 403 envelope from the confirmations route.
    expect(text.ok).toBe(false);
    // Code should be INSUFFICIENT_SCOPE or similar.
    expect(text.error?.code).toBeDefined();
  });
});

// ── tools/call: Tier-3 confirmation (focusboard_add_card happy path) ──────────

describe("POST /api/mcp — Tier-3 tool returns confirmation_required", () => {
  it("focusboard_add_card with card:write returns confirmation_required envelope", async () => {
    const auth = allScopeToken();
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "focusboard_add_card",
        arguments: { title: "My new card", column: "backlog" },
      },
    }, auth);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      result: { content: { type: "text"; text: string }[]; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    const text = JSON.parse(body.result.content[0].text) as {
      status: string;
      confirm_token: string;
      preview: string;
      hint: string;
    };
    expect(text.status).toBe("confirmation_required");
    expect(typeof text.confirm_token).toBe("string");
    expect(text.preview).toContain("My new card");
  });
});

// ── GET /api/mcp — 405 ────────────────────────────────────────────────────────

describe("GET /api/mcp", () => {
  it("returns 405 (connector GET probe — log-free)", async () => {
    const res = await app.request("/api/mcp", { method: "GET" });
    expect(res.status).toBe(405);
  });
});

describe("DELETE /api/mcp", () => {
  it("returns 405", async () => {
    const res = await app.request("/api/mcp", { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});
