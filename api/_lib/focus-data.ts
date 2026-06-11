import { createClient } from "@supabase/supabase-js";
import type { FocusSession, MetricsState } from "../../src/app/types.js";

/**
 * Server-side readers for the Phase 5 digests and focus history.
 *
 * - loadFocusSessions: the focus_sessions TABLE is the system of record
 *   (Phase 3); rows are adapted to the web's FocusSession type so the digest
 *   functions imported from src/app/review.ts consume table truth instead of
 *   the metrics blob's stale copy.
 * - loadMetrics: the metrics blob still owns completedCards/reviewMarkers
 *   (its extraction is a future phase); the API only READS it. There was no
 *   server-side metrics reader before this — the only other reader is the
 *   browser's RLS client in src/app/sync.ts.
 */

type FocusSessionRow = {
  id: string;
  card_id: string | null;
  card_title: string | null;
  planned_minutes: number;
  started_at: string;
  ended_at: string | null;
  outcome: FocusSession["outcome"] | null;
  note: string | null;
};

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  return createClient(url, key);
}

/** Adapt a table row to the web FocusSession shape (snake→camel, timestamptz→ISO). */
export function adaptFocusSessionRow(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    cardId: row.card_id ?? "",
    cardTitle: row.card_title ?? "(untitled)",
    // The table allows 1..480; the web type's 25|50|90 union is a UI conceit.
    plannedMinutes: row.planned_minutes as FocusSession["plannedMinutes"],
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : "",
    outcome: row.outcome ?? "abandoned",
    ...(row.note ? { note: row.note } : {}),
  };
}

/**
 * CLOSED focus sessions for a user since a given instant, newest-first.
 * Open sessions (ended_at IS NULL) are excluded — every consumer (digests,
 * history aggregates) reasons about completed sessions.
 */
export async function loadFocusSessions(userId: string, since: Date): Promise<FocusSession[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("focus_sessions")
    .select("id, card_id, card_title, planned_minutes, started_at, ended_at, outcome, note")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("ended_at", since.toISOString())
    .order("ended_at", { ascending: false });

  if (error) {
    console.error("Focus sessions load error:", error.message);
    throw new Error("Failed to load focus sessions");
  }
  return ((data ?? []) as FocusSessionRow[]).map(adaptFocusSessionRow);
}

const EMPTY_METRICS: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

/** The metrics blob (completedCards, reviewMarkers, streaks). Missing row → empty. */
export async function loadMetrics(userId: string): Promise<MetricsState> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("metrics")
    .select("metrics")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Metrics load error:", error.message);
    throw new Error("Failed to load metrics");
  }
  return (data?.metrics as MetricsState | undefined) ?? EMPTY_METRICS;
}

/** Shared aggregate shape for history + digests (digests expose ONLY this, never raw sessions). */
export type FocusAggregates = {
  sessionCount: number;
  totalMinutes: number;
  byOutcome: Record<string, number>;
};

export function aggregateFocusSessions(sessions: FocusSession[]): FocusAggregates {
  const byOutcome: Record<string, number> = {};
  let totalMinutes = 0;
  for (const s of sessions) {
    byOutcome[s.outcome] = (byOutcome[s.outcome] ?? 0) + 1;
    if (s.endedAt) {
      const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
      totalMinutes += Math.max(0, Math.round(ms / 60_000));
    }
  }
  return { sessionCount: sessions.length, totalMinutes, byOutcome };
}
