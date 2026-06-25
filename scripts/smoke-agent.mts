/**
 * Live smoke test for the board command agent (api/_lib/agent.ts).
 *
 * Runs the REAL Anthropic tool-use loop (real API call) against an IN-MEMORY
 * board — no Supabase, no real board touched. It proves the thing unit tests
 * can't: that the real model, given the real tool schemas + system prompt,
 * actually drives the loop — calls list_cards, reads the result, then issues
 * the right mutations with valid ids, and stops when done. Mutations are
 * reflected in subsequent list_cards (the in-memory store is shared between the
 * read seam and the mutation app), so multi-step reasoning is visible.
 *
 * Usage (needs your key — NOT committed):
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/smoke-agent.mts
 *   # or: put ANTHROPIC_API_KEY in .env.local, then: npx tsx scripts/smoke-agent.mts
 *
 * Cost: one run ≈ 3–5 Sonnet round-trips ≈ ~$0.06.
 */

import { readFileSync, existsSync } from "node:fs";
import { runBoardAgent } from "../api/_lib/agent.js";
import type { BoardData } from "../api/_lib/board.js";

// ── Load ANTHROPIC_API_KEY from env or .env.local ───────────────────────────────
if (!process.env.ANTHROPIC_API_KEY && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
    if (m) process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, "").trim();
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ ANTHROPIC_API_KEY not set. Run: ANTHROPIC_API_KEY=sk-... npx tsx scripts/smoke-agent.mts");
  process.exit(1);
}

// ── In-memory board (shared by the read seam and the mutation app) ──────────────
type MemCard = {
  id: string; title: string; column: string; swimlane: string; order: number;
  tags: string[]; createdAt: string; updatedAt: string; version: number;
};
const NOW = new Date().toISOString();
const store: Record<string, MemCard> = {
  c1: { id: "c1", title: "Redesign landing hero", column: "design", swimlane: "work", order: 0, tags: ["high"], createdAt: NOW, updatedAt: NOW, version: 1 },
  c2: { id: "c2", title: "Pick new icon set", column: "design", swimlane: "work", order: 1, tags: ["high"], createdAt: NOW, updatedAt: NOW, version: 1 },
  c3: { id: "c3", title: "Buy milk", column: "backlog", swimlane: "personal", order: 0, tags: [], createdAt: NOW, updatedAt: NOW, version: 1 },
};
const COLUMNS = [
  { id: "backlog", title: "Backlog", order: 0, isTerminal: false },
  { id: "todo", title: "To Do", order: 1, isTerminal: false },
  { id: "doing", title: "Doing", order: 2, isTerminal: false },
  { id: "done", title: "Done", order: 3, isTerminal: true },
];
const TAGS = [{ id: "high", name: "High" }, { id: "design", name: "Design" }];
let nextId = 100;

// The agent's list_cards source — reads live from the in-memory store.
const loadBoardFn = async (): Promise<BoardData> => ({
  state: { tags: TAGS } as unknown as BoardData["state"],
  cards: Object.values(store) as unknown as BoardData["cards"],
  columns: COLUMNS as unknown as BoardData["columns"],
  versions: new Map(Object.values(store).map((c) => [c.id, c.version])),
});

// A fake Hono app: implements exactly the routes executeConfirmedOp dispatches.
const fakeApp = {
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const json = (ok: boolean, data: unknown, status = 200) =>
      new Response(JSON.stringify(ok ? { ok, data } : { ok, error: data }), { status });
    const body = method === "GET" ? {} : await req.json().catch(() => ({}));

    // GET /api/cards/:id — fresh version read (the CAS contract)
    const idMatch = path.match(/^\/api\/cards\/([^/]+)$/);
    if (method === "GET" && idMatch) {
      const card = store[decodeURIComponent(idMatch[1])];
      if (!card) return json(false, { code: "NOT_FOUND", message: "Card not found" }, 404);
      return json(true, { card: { ...card } });
    }
    // POST /api/cards — add
    if (method === "POST" && path === "/api/cards") {
      const id = `c${nextId++}`;
      store[id] = { id, title: String(body.title), column: String(body.column ?? "backlog"), swimlane: String(body.swimlane ?? "work"), order: 99, tags: (body.tags as string[]) ?? [], createdAt: NOW, updatedAt: NOW, version: 1 };
      return json(true, { card: { ...store[id] } });
    }
    // POST /api/cards/:id/move
    const moveMatch = path.match(/^\/api\/cards\/([^/]+)\/move$/);
    if (method === "POST" && moveMatch) {
      const card = store[decodeURIComponent(moveMatch[1])];
      if (!card) return json(false, { code: "NOT_FOUND", message: "Card not found" }, 404);
      card.column = String(body.column); card.version++;
      return json(true, { card: { ...card } });
    }
    // POST /api/cards/:id/done
    const doneMatch = path.match(/^\/api\/cards\/([^/]+)\/done$/);
    if (method === "POST" && doneMatch) {
      const card = store[decodeURIComponent(doneMatch[1])];
      if (!card) return json(false, { code: "NOT_FOUND", message: "Card not found" }, 404);
      card.column = "done"; card.version++;
      return json(true, { card: { ...card } });
    }
    // PATCH /api/cards/:id
    if (method === "PATCH" && idMatch) {
      const card = store[decodeURIComponent(idMatch[1])];
      if (!card) return json(false, { code: "NOT_FOUND", message: "Card not found" }, 404);
      if (body.title !== undefined) card.title = String(body.title);
      if (body.tags !== undefined) card.tags = body.tags as string[];
      card.version++;
      return json(true, { card: { ...card } });
    }
    // POST /api/cards/batch-move
    if (method === "POST" && path === "/api/cards/batch-move") {
      for (const m of (body.moves as { id: string; to: string }[]) ?? []) {
        const card = store[m.id];
        if (card) { card.column = m.to; card.version++; }
      }
      return json(true, { moved: (body.moves as unknown[])?.length ?? 0 });
    }
    return json(false, { code: "NOT_FOUND", message: `No route ${method} ${path}` }, 404);
  },
} as never;

// ── Run ─────────────────────────────────────────────────────────────────────────
const instruction =
  process.argv.slice(2).join(" ") ||
  "Move both of my high-priority design cards to To Do, then add a card to 'prep the Q3 deck' in the backlog tagged high.";

console.log("\n▶ Instruction:", instruction);
console.log("\n▶ Board before:");
for (const c of Object.values(store)) console.log(`   [${c.column}] ${c.title} (${c.id})`);

const result = await runBoardAgent({
  app: fakeApp,
  authHeader: "Bearer fb_pat_smoke",
  userId: "smoke-user",
  instruction,
  loadBoardFn,
});

console.log("\n▶ Steps executed:");
for (const s of result.steps) console.log(`   ${s.ok ? "✓" : "✗"} ${s.tool}(${JSON.stringify(s.args)})${s.error ? " — " + s.error : ""}`);
console.log("\n▶ Agent summary:", result.summary);
console.log("\n▶ Board after:");
for (const c of Object.values(store)) console.log(`   [${c.column}] ${c.title} (${c.id})`);
console.log(`\n▶ stoppedAtCap: ${result.stoppedAtCap}\n`);

// Assertions: the model must have moved both design cards to "todo" and added one.
const movedOk = store.c1.column === "todo" && store.c2.column === "todo";
const addedOk = Object.values(store).some((c) => c.column === "backlog" && /q3/i.test(c.title) && c.id !== "c3");
if (movedOk && addedOk) {
  console.log("✅ SMOKE PASS — real model drove the loop and produced the expected board state.\n");
  process.exit(0);
}
console.log(`❌ SMOKE FAIL — movedBoth=${movedOk} addedQ3=${addedOk}. Inspect steps above.\n`);
process.exit(1);
