import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppState, Card, MetricsState } from "./types";

/**
 * Tests for the Phase 4b sync engine: cards live in the `cards` table (per-row
 * optimistic-lock versions), non-card state stays in the app_state blob with
 * the cards key STRIPPED. Saves are diffs against the last-seen server state;
 * CAS misses resolve accept-theirs; realtime echoes are filtered by version
 * (cards) / JSON comparison (blob).
 */

function makeCard(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
    column: "todo",
    order: 0,
    tags: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...over,
  };
}

const baseState: AppState = {
  cards: [makeCard("card-1")],
  columns: [
    { id: "todo", title: "To Do", order: 0, icon: "inbox", color: "#10b981", wipLimit: null, isTerminal: false },
  ],
  templates: [],
  settings: {
    theme: "system",
    celebrations: true,
    reducedMotionOverride: false,
    backgroundImage: null,
    showAgingIndicators: false,
    staleCardThreshold: 7,
    autoPriorityFromDueDate: false,
    staleBacklogThreshold: 7,
    collapsedSwimlanes: [],
    autoArchive: true,
  },
  tagCategories: [],
  tags: [],
};

function nonCardsOf(state: AppState): Record<string, unknown> {
  const rest = { ...state } as Partial<AppState>;
  delete rest.cards;
  return rest as Record<string, unknown>;
}

const mockMetrics: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

type DbRow = { id: string; card_json: Card; version: number };

/**
 * A fake Supabase client with a tiny in-memory cards table so the diff/CAS
 * logic is exercised against real(ish) server behavior: updates and deletes
 * only land when the version filter matches, exactly like Postgres.
 */
function makeDb(opts: { blob?: Record<string, unknown> | null; rows?: DbRow[]; blobError?: boolean } = {}) {
  const rows = new Map<string, DbRow>((opts.rows ?? []).map((r) => [r.id, { ...r }]));
  let blob = opts.blob ?? null;

  const calls = {
    blobUpserts: [] as Record<string, unknown>[],
    cardInserts: [] as Record<string, unknown>[][],
    cardUpdates: [] as { payload: Record<string, unknown>; filters: Record<string, unknown> }[],
    cardDeletes: [] as { filters: Record<string, unknown> }[],
  };

  function cardsBuilder() {
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" | "delete" = "select";
    let updatePayload: Record<string, unknown> = {};

    const allRows = () =>
      [...rows.values()].map((r) => ({ id: r.id, card_json: r.card_json, version: r.version }));

    const b: Record<string, unknown> = {
      select() {
        if (op === "update") {
          const row = rows.get(filters.id as string);
          calls.cardUpdates.push({ payload: updatePayload, filters: { ...filters } });
          if (row && row.version === filters.version) {
            row.card_json = updatePayload.card_json as Card;
            row.version = updatePayload.version as number;
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }
        if (op === "delete") {
          const row = rows.get(filters.id as string);
          calls.cardDeletes.push({ filters: { ...filters } });
          if (row && row.version === filters.version) {
            rows.delete(row.id);
            return Promise.resolve({ data: [{ id: row.id }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }
        return b;
      },
      eq(col: string, val: unknown) {
        filters[col] = val;
        return b;
      },
      maybeSingle: async () => {
        const row = rows.get(filters.id as string);
        return {
          data: row ? { id: row.id, card_json: row.card_json, version: row.version } : null,
          error: null,
        };
      },
      // New-card writes use upsert with ignoreDuplicates (retry-idempotent
      // insert) — existing rows are left untouched, like ON CONFLICT DO NOTHING.
      upsert: async (arr: Record<string, unknown>[]) => {
        calls.cardInserts.push(arr);
        for (const r of arr) {
          if (rows.has(r.id as string)) continue;
          rows.set(r.id as string, { id: r.id as string, card_json: r.card_json as Card, version: 1 });
        }
        return { error: null };
      },
      update(payload: Record<string, unknown>) {
        op = "update";
        updatePayload = payload;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      // Awaiting the bare select().eq() chain resolves every row (the load path).
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve({ data: allRows(), error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  const channelHandlers: Record<string, (payload: unknown) => void> = {};
  const mockChannel = {
    on: vi.fn((_type: string, cfg: { event: string; table: string }, handler: (p: unknown) => void) => {
      channelHandlers[`${cfg.event}:${cfg.table}`] = handler;
      return mockChannel;
    }),
    subscribe: vi.fn().mockReturnThis(),
  };

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
    },
    from: vi.fn((table: string) => {
      if (table === "app_state") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.blobError
                  ? { data: null, error: { code: "BOOM", message: "query failed" } }
                  : { data: blob ? { state: blob } : null, error: null },
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            calls.blobUpserts.push(row);
            blob = row.state as Record<string, unknown>;
            return { error: null };
          },
        };
      }
      if (table === "cards") return cardsBuilder();
      throw new Error(`unexpected table ${table}`);
    }),
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
  };

  return {
    supabase,
    calls,
    rows,
    mockChannel,
    fire: (event: string, table: string, payload: unknown) => channelHandlers[`${event}:${table}`]?.(payload),
  };
}

async function importSyncWith(db: ReturnType<typeof makeDb>) {
  vi.doMock("./supabase", () => ({ supabase: db.supabase }));
  return await import("./sync");
}

describe("sync.ts without Supabase", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("./supabase", () => ({ supabase: null }));
  });

  it("loadStateFromSupabase returns null", async () => {
    const { loadStateFromSupabase } = await import("./sync");
    expect(await loadStateFromSupabase()).toBeNull();
  });

  it("saveStateToSupabase returns false", async () => {
    const { saveStateToSupabase } = await import("./sync");
    expect(await saveStateToSupabase(baseState)).toBe(false);
  });

  it("loadMetricsFromSupabase returns null", async () => {
    const { loadMetricsFromSupabase } = await import("./sync");
    expect(await loadMetricsFromSupabase()).toBeNull();
  });

  it("saveMetricsToSupabase returns false", async () => {
    const { saveMetricsToSupabase } = await import("./sync");
    expect(await saveMetricsToSupabase(mockMetrics)).toBe(false);
  });

  it("subscribeToBoardChanges returns null", async () => {
    const { subscribeToBoardChanges } = await import("./sync");
    expect(subscribeToBoardChanges("user-123", { onCards: vi.fn(), onBoard: vi.fn() })).toBeNull();
  });
});

describe("loadStateFromSupabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null when the user is not authenticated", async () => {
    const db = makeDb();
    db.supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { loadStateFromSupabase } = await importSyncWith(db);
    expect(await loadStateFromSupabase()).toBeNull();
  });

  it("returns null for a new user (no blob row)", async () => {
    const db = makeDb({ blob: null });
    const { loadStateFromSupabase } = await importSyncWith(db);
    expect(await loadStateFromSupabase()).toBeNull();
  });

  it("merges non-card blob state with cards-table rows (rows beat legacy blob cards)", async () => {
    const rowCard = makeCard("row-1", { title: "From rows" });
    const db = makeDb({
      // Legacy blob still carrying a stale cards array — must be ignored.
      blob: { ...nonCardsOf(baseState), cards: [makeCard("stale-1")] },
      rows: [{ id: "row-1", card_json: rowCard, version: 4 }],
    });
    const { loadStateFromSupabase } = await importSyncWith(db);
    const state = await loadStateFromSupabase();
    expect(state?.cards).toEqual([rowCard]);
    expect(state?.columns).toEqual(baseState.columns);
    expect(state?.settings).toEqual(baseState.settings);
  });

  it("returns null and disables card writes when the load query fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb({ blobError: true, rows: [{ id: "r", card_json: makeCard("r"), version: 1 }] });
    const { loadStateFromSupabase, saveStateToSupabase } = await importSyncWith(db);

    expect(await loadStateFromSupabase()).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith("Failed to load state from Supabase:", expect.any(Object));

    // Without a snapshot, a save must never touch the cards table — we cannot
    // diff against a server state we do not know.
    const ok = await saveStateToSupabase(baseState);
    expect(ok).toBe(false);
    expect(db.calls.cardInserts).toHaveLength(0);
    expect(db.calls.cardUpdates).toHaveLength(0);
    expect(db.calls.cardDeletes).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});

describe("saveStateToSupabase (diff + CAS)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns false when the user is not authenticated", async () => {
    const db = makeDb();
    db.supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { saveStateToSupabase } = await importSyncWith(db);
    expect(await saveStateToSupabase(baseState)).toBe(false);
  });

  it("no changes → no writes at all", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 2 }] });
    const sync = await importSyncWith(db);

    const loaded = await sync.loadStateFromSupabase();
    expect(await sync.saveStateToSupabase(loaded!)).toBe(true);

    expect(db.calls.blobUpserts).toHaveLength(0);
    expect(db.calls.cardInserts).toHaveLength(0);
    expect(db.calls.cardUpdates).toHaveLength(0);
    expect(db.calls.cardDeletes).toHaveLength(0);
  });

  it("a changed card updates behind a version CAS and bumps the version", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 2 }] });
    const sync = await importSyncWith(db);

    const loaded = await sync.loadStateFromSupabase();
    const edited = { ...loaded!, cards: [{ ...loaded!.cards[0]!, title: "Renamed" }] };
    expect(await sync.saveStateToSupabase(edited)).toBe(true);

    expect(db.calls.cardUpdates).toHaveLength(1);
    const { payload, filters } = db.calls.cardUpdates[0]!;
    expect(filters.version).toBe(2);
    expect(payload.version).toBe(3);
    expect((payload.card_json as Card).title).toBe("Renamed");
    expect(db.rows.get("card-1")!.version).toBe(3);

    // The snapshot advanced — saving the same state again is a no-op.
    expect(await sync.saveStateToSupabase(edited)).toBe(true);
    expect(db.calls.cardUpdates).toHaveLength(1);
  });

  it("a new card inserts; a removed card deletes behind the version guard", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 5 }] });
    const sync = await importSyncWith(db);

    const loaded = await sync.loadStateFromSupabase();
    const added = makeCard("card-2", { title: "Brand new" });
    expect(await sync.saveStateToSupabase({ ...loaded!, cards: [added] })).toBe(true);

    expect(db.calls.cardInserts).toHaveLength(1);
    expect(db.calls.cardInserts[0]![0]).toMatchObject({ user_id: "user-123", id: "card-2" });
    expect(db.calls.cardDeletes).toHaveLength(1);
    expect(db.calls.cardDeletes[0]!.filters).toMatchObject({ id: "card-1", version: 5 });
    expect(db.rows.has("card-1")).toBe(false);
    expect(db.rows.get("card-2")!.version).toBe(1);
  });

  it("saves non-card state to the blob WITHOUT a cards key, only when it changed", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 1 }] });
    const sync = await importSyncWith(db);

    const loaded = await sync.loadStateFromSupabase();
    const edited = { ...loaded!, settings: { ...loaded!.settings, celebrations: false } };
    expect(await sync.saveStateToSupabase(edited)).toBe(true);

    expect(db.calls.blobUpserts).toHaveLength(1);
    const savedState = db.calls.blobUpserts[0]!.state as Record<string, unknown>;
    expect(savedState).not.toHaveProperty("cards");
    expect((savedState.settings as Record<string, unknown>).celebrations).toBe(false);
    expect(db.calls.cardUpdates).toHaveLength(0);

    // Unchanged on the second save → no second upsert.
    expect(await sync.saveStateToSupabase(edited)).toBe(true);
    expect(db.calls.blobUpserts).toHaveLength(1);
  });

  it("CAS miss (external edit won) → accepts THEIRS and reports it via onCards", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 2 }] });
    const sync = await importSyncWith(db);

    const onCards = vi.fn();
    sync.subscribeToBoardChanges("user-123", { onCards, onBoard: vi.fn() });

    const loaded = await sync.loadStateFromSupabase();

    // External writer (CLI/MCP) lands first: version moves 2 → 3.
    const theirs = { ...card, title: "External edit" };
    db.rows.set("card-1", { id: "card-1", card_json: theirs, version: 3 });

    const edited = { ...loaded!, cards: [{ ...loaded!.cards[0]!, title: "Local edit" }] };
    await sync.saveStateToSupabase(edited);

    // Our CAS (expected 2) missed; theirs survives untouched on the server.
    expect(db.rows.get("card-1")!.card_json.title).toBe("External edit");
    expect(db.rows.get("card-1")!.version).toBe(3);
    expect(onCards).toHaveBeenCalledWith({ upserts: [theirs], removes: [] });
  });

  it("CAS miss on a deleted card → reports the removal", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 2 }] });
    const sync = await importSyncWith(db);

    const onCards = vi.fn();
    sync.subscribeToBoardChanges("user-123", { onCards, onBoard: vi.fn() });

    const loaded = await sync.loadStateFromSupabase();
    db.rows.delete("card-1"); // externally deleted

    const edited = { ...loaded!, cards: [{ ...loaded!.cards[0]!, title: "Local edit" }] };
    await sync.saveStateToSupabase(edited);

    expect(onCards).toHaveBeenCalledWith({ upserts: [], removes: ["card-1"] });
  });

  it("realtime echo landing before the insert bookkeeping keeps the server-confirmed entry", async () => {
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [] });
    const sync = await importSyncWith(db);
    const onCards = vi.fn();
    sync.subscribeToBoardChanges("user-123", { onCards, onBoard: vi.fn() });
    const loaded = await sync.loadStateFromSupabase();

    // The INSERT echo for our own new card arrives before our save runs
    // (e.g. the realtime socket beats the slow HTTP response).
    const fresh = makeCard("card-new");
    db.rows.set("card-new", { id: "card-new", card_json: fresh, version: 1 });
    db.fire("INSERT", "cards", { new: { id: "card-new", card_json: fresh, version: 1 } });

    await sync.saveStateToSupabase({
      ...baseState,
      ...(loaded ?? {}),
      cards: [fresh],
    });

    // The save sees the card already snapshotted at the server version — the
    // upsert no-ops on the duplicate and nothing is clobbered.
    expect(db.rows.get("card-new")!.version).toBe(1);
    expect(db.calls.cardUpdates).toHaveLength(0);

    // Saving again is a clean no-op.
    db.calls.cardInserts.length = 0;
    await sync.saveStateToSupabase({ ...baseState, ...(loaded ?? {}), cards: [fresh] });
    expect(db.calls.cardInserts).toHaveLength(0);
  });

  it("delete CAS miss (externally changed) → keeps theirs and resurrects the card", async () => {
    const card = makeCard("card-1");
    const db = makeDb({ blob: nonCardsOf(baseState), rows: [{ id: "card-1", card_json: card, version: 2 }] });
    const sync = await importSyncWith(db);

    const onCards = vi.fn();
    sync.subscribeToBoardChanges("user-123", { onCards, onBoard: vi.fn() });

    const loaded = await sync.loadStateFromSupabase();
    const theirs = { ...card, title: "Edited while we deleted" };
    db.rows.set("card-1", { id: "card-1", card_json: theirs, version: 3 });

    await sync.saveStateToSupabase({ ...loaded!, cards: [] });

    // Version-guarded delete missed → the row survives and comes back to us.
    expect(db.rows.has("card-1")).toBe(true);
    expect(onCards).toHaveBeenCalledWith({ upserts: [theirs], removes: [] });
  });
});

describe("subscribeToBoardChanges (realtime)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function subscribed(rows: DbRow[] = []) {
    const db = makeDb({ blob: nonCardsOf(baseState), rows });
    const sync = await importSyncWith(db);
    const onCards = vi.fn();
    const onBoard = vi.fn();
    const unsubscribe = sync.subscribeToBoardChanges("user-123", { onCards, onBoard });
    await sync.loadStateFromSupabase(); // initializes the snapshot
    return { db, sync, onCards, onBoard, unsubscribe };
  }

  it("subscribes to app_state UPDATE + cards INSERT/UPDATE/DELETE on one channel", async () => {
    const { db } = await subscribed();
    expect(db.supabase.channel).toHaveBeenCalledWith("board_changes:user-123");
    const events = db.mockChannel.on.mock.calls.map((c) => `${(c[1] as { event: string }).event}:${(c[1] as { table: string }).table}`);
    expect(events).toEqual(
      expect.arrayContaining(["UPDATE:app_state", "INSERT:cards", "UPDATE:cards", "DELETE:cards"])
    );
    expect(db.mockChannel.subscribe).toHaveBeenCalled();
  });

  it("delivers external card upserts and advances the snapshot", async () => {
    const card = makeCard("card-1");
    const { onCards, fireCard } = await (async () => {
      const ctx = await subscribed([{ id: "card-1", card_json: card, version: 2 }]);
      return { ...ctx, fireCard: (row: DbRow) => ctx.db.fire("UPDATE", "cards", { new: row }) };
    })();

    const theirs = { ...card, title: "From the CLI" };
    fireCard({ id: "card-1", card_json: theirs, version: 3 });
    expect(onCards).toHaveBeenCalledWith({ upserts: [theirs], removes: [] });
  });

  it("drops echoes of our own card writes (version not newer than snapshot)", async () => {
    const card = makeCard("card-1");
    const { db, onCards } = await subscribed([{ id: "card-1", card_json: card, version: 2 }]);

    db.fire("UPDATE", "cards", { new: { id: "card-1", card_json: card, version: 2 } });
    db.fire("UPDATE", "cards", { new: { id: "card-1", card_json: card, version: 1 } });
    expect(onCards).not.toHaveBeenCalled();
  });

  it("delivers external INSERTs of brand-new cards", async () => {
    const { db, onCards } = await subscribed([]);
    const fresh = makeCard("ext-1", { title: "Added by fb add" });
    db.fire("INSERT", "cards", { new: { id: "ext-1", card_json: fresh, version: 1 } });
    expect(onCards).toHaveBeenCalledWith({ upserts: [fresh], removes: [] });
  });

  it("delivers external DELETEs for known cards, drops echoes of our own", async () => {
    const card = makeCard("card-1");
    const { db, onCards } = await subscribed([{ id: "card-1", card_json: card, version: 2 }]);

    db.fire("DELETE", "cards", { old: { user_id: "user-123", id: "ghost" } }); // ours already gone
    expect(onCards).not.toHaveBeenCalled();

    db.fire("DELETE", "cards", { old: { user_id: "user-123", id: "card-1" } });
    expect(onCards).toHaveBeenCalledWith({ upserts: [], removes: ["card-1"] });
  });

  it("ignores DELETE events for other users", async () => {
    const card = makeCard("card-1");
    const { db, onCards } = await subscribed([{ id: "card-1", card_json: card, version: 2 }]);
    db.fire("DELETE", "cards", { old: { user_id: "someone-else", id: "card-1" } });
    expect(onCards).not.toHaveBeenCalled();
  });

  it("delivers external non-card state without cards, dropping echoes of our own blob save", async () => {
    const { db, onBoard } = await subscribed();

    // Echo: same non-card state we loaded.
    db.fire("UPDATE", "app_state", { new: { state: nonCardsOf(baseState) } });
    expect(onBoard).not.toHaveBeenCalled();

    // Genuine external change (settings differ), legacy cards array present.
    const external = {
      ...nonCardsOf(baseState),
      settings: { ...baseState.settings, celebrations: false },
      cards: [makeCard("stale")],
    };
    db.fire("UPDATE", "app_state", { new: { state: external } });
    expect(onBoard).toHaveBeenCalledTimes(1);
    const delivered = onBoard.mock.calls[0]![0] as Record<string, unknown>;
    expect(delivered).not.toHaveProperty("cards");
    expect((delivered.settings as Record<string, unknown>).celebrations).toBe(false);
  });

  it("removes the channel on unsubscribe", async () => {
    const { db, unsubscribe } = await subscribed();
    unsubscribe?.();
    expect(db.supabase.removeChannel).toHaveBeenCalledWith(db.mockChannel);
  });
});

describe("metrics sync (unchanged blob)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("loadMetricsFromSupabase returns metrics when they exist", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }) },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { metrics: mockMetrics }, error: null }),
            }),
          }),
        }),
      },
    }));
    const { loadMetricsFromSupabase } = await import("./sync");
    expect(await loadMetricsFromSupabase()).toEqual(mockMetrics);
  });

  it("saveMetricsToSupabase upserts the metrics row", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }) },
        from: mockFrom,
      },
    }));
    const { saveMetricsToSupabase } = await import("./sync");
    expect(await saveMetricsToSupabase(mockMetrics)).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("metrics");
  });
});

describe("debounced sync functions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancelPendingSaveToSupabase drops a queued save without flushing", async () => {
    // Regression test for the cloud-wipe race: the empty default state
    // queued at mount must be discardable so it can't overwrite real
    // cloud data after IMPORT_STATE arrives.
    const db = makeDb({ blob: nonCardsOf(baseState) });
    const { debouncedSaveToSupabase, cancelPendingSaveToSupabase } = await importSyncWith(db);

    debouncedSaveToSupabase(baseState);
    cancelPendingSaveToSupabase();

    await vi.advanceTimersByTimeAsync(2000);

    expect(db.supabase.from).not.toHaveBeenCalled();
  });

  it("debouncedSaveToSupabase debounces saves", async () => {
    const db = makeDb({ blob: nonCardsOf(baseState) });
    const sync = await importSyncWith(db);
    await sync.loadStateFromSupabase();
    db.supabase.from.mockClear();

    const edited = { ...baseState, settings: { ...baseState.settings, celebrations: false } };
    sync.debouncedSaveToSupabase(edited);
    sync.debouncedSaveToSupabase(edited);
    sync.debouncedSaveToSupabase(edited);

    expect(db.supabase.from).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1);

    expect(db.calls.blobUpserts).toHaveLength(1);
  });

  it("debouncedSaveMetricsToSupabase debounces independently", async () => {
    const db = makeDb({ blob: nonCardsOf(baseState) });
    // Metrics writes go through from("metrics") — extend the fake.
    const metricsUpserts: unknown[] = [];
    const origFrom = db.supabase.from.getMockImplementation()!;
    db.supabase.from.mockImplementation((table: string) => {
      if (table === "metrics") {
        return { upsert: async (row: unknown) => { metricsUpserts.push(row); return { error: null }; } };
      }
      return origFrom(table);
    });

    const sync = await importSyncWith(db);
    await sync.loadStateFromSupabase();

    const edited = { ...baseState, settings: { ...baseState.settings, celebrations: false } };
    sync.debouncedSaveToSupabase(edited);
    sync.debouncedSaveMetricsToSupabase(mockMetrics);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1);

    expect(db.calls.blobUpserts).toHaveLength(1);
    expect(metricsUpserts).toHaveLength(1);
  });
});
