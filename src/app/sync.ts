import { supabase } from "./supabase";
import type { AppState, Card, FocusSession, MetricsState } from "./types";

/**
 * Cloud sync (Phase 4b: per-card row writes).
 *
 * Cards live in the `cards` table — one row per card with an optimistic-lock
 * `version` — shared with the CLI/MCP/API writers. Non-card board state
 * (columns, settings, tags, templates, daily plan) stays in the `app_state`
 * blob, saved WITHOUT a cards key (the blob's cards array is retired).
 *
 * Saving diffs the in-memory state against a snapshot of what this client last
 * saw on the server: new cards insert, changed cards update behind a per-card
 * version compare-and-swap, removed cards delete behind the same guard. A CAS
 * miss means an external writer (CLI/MCP/another tab) got there first — we
 * accept THEIRS: re-fetch the row, fold it into the snapshot, and hand it back
 * to the app, which converges instead of clobbering.
 *
 * Realtime is split the same way: per-card INSERT/UPDATE/DELETE events from
 * `cards` (echoes of our own writes are dropped by version), and app_state
 * UPDATE events for non-card state (echoes dropped by JSON comparison).
 *
 * Demo mode (no Supabase client) is untouched: every function no-ops and the
 * app runs on localStorage alone.
 */

export type NonCardState = Omit<AppState, "cards">;

export type RemoteCardChange = { upserts: Card[]; removes: string[] };

export type BoardChangeHandlers = {
  /** Per-card external changes (realtime or conflict resolution). */
  onCards: (change: RemoteCardChange) => void;
  /** External non-card board state (settings, columns, tags, …). */
  onBoard: (board: NonCardState) => void;
};

type CardRow = { id: string; card_json: Card; version: number };

// What this client last saw on the server. `null` = no successful load yet —
// card writes stay disabled so we can never diff against a state we don't know.
let cardSnapshot: Map<string, { json: string; version: number }> | null = null;
let lastSyncedNonCardsJson: string | null = null;
let boardHandlers: BoardChangeHandlers | null = null;

function stripCards(state: AppState): NonCardState {
  const rest = { ...state } as Partial<AppState>;
  delete rest.cards;
  return rest as NonCardState;
}

/** Reset module sync state (sign-out / tests). */
export function resetCloudSyncState(): void {
  cardSnapshot = null;
  lastSyncedNonCardsJson = null;
}

// ── Load ───────────────────────────────────────────────────────────────────────

// Load app state from Supabase: non-card state from the app_state blob, cards
// from the cards table. Initializes the diff snapshot as a side effect.
export async function loadStateFromSupabase(): Promise<AppState | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [blobRes, cardsRes] = await Promise.all([
    supabase.from("app_state").select("state").eq("user_id", user.id).maybeSingle(),
    supabase.from("cards").select("id, card_json, version").eq("user_id", user.id),
  ]);

  if (blobRes.error || cardsRes.error) {
    // A failed QUERY (vs. a missing row) means we don't know the server state;
    // leave the snapshot null so card writes stay disabled this session rather
    // than diffing against a guess.
    console.error(
      "Failed to load state from Supabase:",
      blobRes.error ?? cardsRes.error
    );
    return null;
  }

  const rows = (cardsRes.data ?? []) as CardRow[];
  cardSnapshot = new Map(
    rows.map((r) => [r.id, { json: JSON.stringify(r.card_json), version: Number(r.version) }])
  );

  if (!blobRes.data?.state) {
    // New user: no board yet. Snapshot is initialized (empty) so first save works.
    lastSyncedNonCardsJson = null;
    return null;
  }

  // The blob may still carry a legacy cards array until the cleanup migration
  // strips it — rows win unconditionally.
  const nonCards = stripCards(blobRes.data.state as AppState);
  lastSyncedNonCardsJson = JSON.stringify(nonCards);

  const cards = rows
    .map((r) => r.card_json)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return { ...nonCards, cards } as AppState;
}

// ── Save ───────────────────────────────────────────────────────────────────────

async function resolveCardConflict(
  client: NonNullable<typeof supabase>,
  userId: string,
  cardId: string,
  change: RemoteCardChange
): Promise<void> {
  const snap = cardSnapshot;
  if (!snap) return;
  const { data } = await client
    .from("cards")
    .select("id, card_json, version")
    .eq("user_id", userId)
    .eq("id", cardId)
    .maybeSingle();
  if (data) {
    const row = data as CardRow;
    snap.set(cardId, { json: JSON.stringify(row.card_json), version: Number(row.version) });
    change.upserts.push(row.card_json);
  } else {
    snap.delete(cardId);
    change.removes.push(cardId);
  }
}

// Save app state to Supabase as a diff against the last-seen server state.
export async function saveStateToSupabase(state: AppState): Promise<boolean> {
  if (!supabase) return false;
  const client = supabase;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;

  let allOk = true;

  // 1. Non-card state → the blob, cards key stripped, only when it changed.
  const nonCards = stripCards(state);
  const nonCardsJson = JSON.stringify(nonCards);
  if (nonCardsJson !== lastSyncedNonCardsJson) {
    const { error } = await client.from("app_state").upsert(
      { user_id: user.id, state: nonCards, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (error) {
      console.error("Failed to save board state to Supabase:", error);
      allOk = false;
    } else {
      lastSyncedNonCardsJson = nonCardsJson;
    }
  }

  // 2. Cards → per-row diff. No snapshot (load never succeeded) → skip card
  // writes entirely; we cannot safely diff.
  const snap = cardSnapshot;
  if (!snap) return false;

  const seen = new Set<string>();
  const inserts: { card: Card; json: string }[] = [];
  const updates: { card: Card; json: string; expected: number }[] = [];
  for (const card of state.cards) {
    seen.add(card.id);
    const prev = snap.get(card.id);
    const json = JSON.stringify(card);
    if (!prev) {
      inserts.push({ card, json });
    } else if (prev.json !== json) {
      updates.push({ card, json, expected: prev.version });
    }
  }
  const removes: { id: string; expected: number }[] = [];
  for (const [id, prev] of snap) {
    if (!seen.has(id)) removes.push({ id, expected: prev.version });
  }

  // External changes discovered through CAS misses, delivered to the app after
  // the snapshot is consistent again (accept-theirs).
  const conflictChange: RemoteCardChange = { upserts: [], removes: [] };

  if (inserts.length > 0) {
    const { error } = await client.from("cards").insert(
      inserts.map(({ card }) => ({ user_id: user.id, id: card.id, card_json: card }))
    );
    if (error) {
      console.error("Failed to insert cards to Supabase:", error);
      allOk = false;
    } else {
      for (const { card, json } of inserts) snap.set(card.id, { json, version: 1 });
    }
  }

  await Promise.all(
    updates.map(async ({ card, json, expected }) => {
      const { data, error } = await client
        .from("cards")
        .update({ card_json: card, version: expected + 1, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", card.id)
        .eq("version", expected)
        .select("id");
      if (error) {
        console.error("Failed to update card in Supabase:", error);
        allOk = false;
        return;
      }
      if ((data ?? []).length > 0) {
        snap.set(card.id, { json, version: expected + 1 });
      } else {
        // CAS miss: an external writer changed (or deleted) this card.
        await resolveCardConflict(client, user.id, card.id, conflictChange);
      }
    })
  );

  await Promise.all(
    removes.map(async ({ id, expected }) => {
      const { data, error } = await client
        .from("cards")
        .delete()
        .eq("user_id", user.id)
        .eq("id", id)
        .eq("version", expected)
        .select("id");
      if (error) {
        console.error("Failed to delete card in Supabase:", error);
        allOk = false;
        return;
      }
      if ((data ?? []).length > 0) {
        snap.delete(id);
      } else {
        // CAS miss: changed externally since we read it (keep theirs), or
        // already deleted (converged) — resolve either way.
        await resolveCardConflict(client, user.id, id, conflictChange);
      }
    })
  );

  if (conflictChange.upserts.length > 0 || conflictChange.removes.length > 0) {
    boardHandlers?.onCards(conflictChange);
  }

  return allOk;
}

// ── Metrics (unchanged blob) ───────────────────────────────────────────────────

// Load metrics from Supabase
export async function loadMetricsFromSupabase(): Promise<MetricsState | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("metrics")
    .select("metrics")
    .eq("user_id", user.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row found - new user
      return null;
    }
    console.error("Failed to load metrics from Supabase:", error);
    return null;
  }

  return data?.metrics as MetricsState | null;
}

// Save metrics to Supabase
export async function saveMetricsToSupabase(metrics: MetricsState): Promise<boolean> {
  if (!supabase) return false;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("metrics")
    .upsert(
      {
        user_id: user.id,
        metrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("Failed to save metrics to Supabase:", error);
    return false;
  }

  return true;
}

// Append a completed focus session to the focus_sessions table (Phase 3).
//
// The table is the system of record for focus sessions — the CLI/MCP/API read
// and write it exclusively. The web still keeps its metrics-blob copy for the
// dashboards (flipping those readers to the table is a follow-up); this append
// is fire-and-forget so a failure can never break the focus-mode UX. RLS scopes
// the insert to the signed-in user; demo mode (no session) is a silent no-op.
export async function appendFocusSessionToSupabase(session: FocusSession): Promise<boolean> {
  if (!supabase) return false;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("focus_sessions").insert({
    id: session.id,
    user_id: user.id,
    card_id: session.cardId,
    card_title: session.cardTitle,
    planned_minutes: session.plannedMinutes,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    outcome: session.outcome,
    note: session.note ?? null,
    source: "web",
  });

  if (error) {
    console.error("Failed to append focus session to Supabase:", error);
    return false;
  }
  return true;
}

// ── Realtime ───────────────────────────────────────────────────────────────────

// Subscribe to board changes (multi-device / CLI / MCP sync): per-card events
// from the cards table + non-card state from app_state. Echoes of this
// client's own writes are filtered precisely — by version for cards, by JSON
// comparison for the blob — instead of the old wall-clock suppression window.
export function subscribeToBoardChanges(
  userId: string,
  handlers: BoardChangeHandlers
): (() => void) | null {
  if (!supabase) return null;

  boardHandlers = handlers;
  const client = supabase; // Capture for closure

  const onCardUpsert = (payload: { new: Record<string, unknown> }) => {
    const row = payload.new as unknown as CardRow;
    if (!row?.id || !row.card_json) return;
    const snap = cardSnapshot;
    if (!snap) return; // No load yet — initial load will pick this up.
    const version = Number(row.version);
    const prev = snap.get(row.id);
    if (prev && prev.version >= version) return; // Echo of our own write (or stale).
    snap.set(row.id, { json: JSON.stringify(row.card_json), version });
    handlers.onCards({ upserts: [row.card_json], removes: [] });
  };

  const onCardDelete = (payload: { old: Record<string, unknown> }) => {
    const old = payload.old as { user_id?: string; id?: string };
    if (!old?.id) return;
    if (old.user_id && old.user_id !== userId) return;
    const snap = cardSnapshot;
    if (!snap) return;
    if (!snap.has(old.id)) return; // Echo of our own delete.
    snap.delete(old.id);
    handlers.onCards({ upserts: [], removes: [old.id] });
  };

  const channel = client
    .channel(`board_changes:${userId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "app_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        const newState = (payload.new as { state?: AppState })?.state;
        if (!newState) return;
        // Strip any legacy cards array (pre-cleanup blobs) — cards arrive
        // through the cards-table events, never through the blob.
        const nonCards = stripCards(newState);
        const json = JSON.stringify(nonCards);
        if (json === lastSyncedNonCardsJson) return; // Echo of our own save.
        lastSyncedNonCardsJson = json;
        handlers.onBoard(nonCards);
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "cards", filter: `user_id=eq.${userId}` },
      onCardUpsert
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "cards", filter: `user_id=eq.${userId}` },
      onCardUpsert
    )
    .on(
      "postgres_changes",
      // Realtime DELETE payloads only carry the old PK (no filter support);
      // scope-check in the handler instead.
      { event: "DELETE", schema: "public", table: "cards" },
      onCardDelete
    )
    .subscribe();

  return () => {
    boardHandlers = null;
    void client.removeChannel(channel);
  };
}

// ── Debounced save plumbing ────────────────────────────────────────────────────

// Debounced save to avoid too many writes
// Uses requestIdleCallback after debounce so JSON.stringify (the diff runs
// serialization) never blocks drag interactions.
const hasIdleCallback = typeof requestIdleCallback === "function";

let stateTimeout: ReturnType<typeof setTimeout> | null = null;
let stateIdleHandle: number | null = null;
let metricsTimeout: ReturnType<typeof setTimeout> | null = null;
let queuedState: AppState | null = null;
let queuedMetrics: MetricsState | null = null;
const SAVE_DEBOUNCE_MS = 1000;

function cancelStateIdle(): void {
  if (stateIdleHandle !== null) {
    if (hasIdleCallback) cancelIdleCallback(stateIdleHandle);
    else clearTimeout(stateIdleHandle);
    stateIdleHandle = null;
  }
}

function scheduleIdle(fn: () => void): number {
  if (hasIdleCallback) return requestIdleCallback(fn);
  return window.setTimeout(fn, 0) as unknown as number;
}

export function debouncedSaveToSupabase(state: AppState): void {
  queuedState = state;
  if (stateTimeout) clearTimeout(stateTimeout);
  cancelStateIdle();
  stateTimeout = setTimeout(() => {
    const pending = queuedState;
    queuedState = null;
    stateTimeout = null;
    if (pending) {
      stateIdleHandle = scheduleIdle(() => {
        stateIdleHandle = null;
        void saveStateToSupabase(pending);
      });
    }
  }, SAVE_DEBOUNCE_MS);
}

export function debouncedSaveMetricsToSupabase(metrics: MetricsState): void {
  queuedMetrics = metrics;
  if (metricsTimeout) clearTimeout(metricsTimeout);
  metricsTimeout = setTimeout(() => {
    if (queuedMetrics) {
      void saveMetricsToSupabase(queuedMetrics);
      queuedMetrics = null;
    }
    metricsTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}

export function flushSaveToSupabase(): void {
  if (stateTimeout) {
    clearTimeout(stateTimeout);
    stateTimeout = null;
  }
  cancelStateIdle();
  if (queuedState) {
    void saveStateToSupabase(queuedState);
    queuedState = null;
  }
}

/**
 * Drop any pending Supabase state save without flushing. Used to prevent
 * the initial empty-default state from wiping cloud data during the race
 * window between mount and first cloud-load completion.
 */
export function cancelPendingSaveToSupabase(): void {
  if (stateTimeout) {
    clearTimeout(stateTimeout);
    stateTimeout = null;
  }
  cancelStateIdle();
  queuedState = null;
}

export function flushSaveMetricsToSupabase(): void {
  if (metricsTimeout) {
    clearTimeout(metricsTimeout);
    metricsTimeout = null;
  }
  if (queuedMetrics) {
    void saveMetricsToSupabase(queuedMetrics);
    queuedMetrics = null;
  }
}
