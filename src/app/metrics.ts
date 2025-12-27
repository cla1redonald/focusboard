import type { Card, Column, CompletedCardMetric, MetricsState, DailySnapshot } from "./types";

const METRICS_KEY = "focusboard:metrics";
const MAX_COMPLETED_CARDS = 500;
const MAX_DAILY_SNAPSHOTS = 90;

const DEFAULT_METRICS: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  wipViolations: 0,
};

export function loadMetrics(): MetricsState {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    if (!raw) return DEFAULT_METRICS;
    const parsed = JSON.parse(raw);
    return {
      completedCards: parsed.completedCards ?? [],
      dailySnapshots: parsed.dailySnapshots ?? [],
      wipViolations: parsed.wipViolations ?? 0,
      lastSnapshotDate: parsed.lastSnapshotDate,
    };
  } catch {
    return DEFAULT_METRICS;
  }
}

export function saveMetrics(metrics: MetricsState): void {
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
}

export function recordCompletedCard(
  card: Card,
  columns: Column[],
  metrics: MetricsState
): MetricsState {
  const completedAt = card.completedAt || new Date().toISOString();
  const createdAt = card.createdAt;

  // Calculate lead time (creation to completion)
  const leadTimeMs = new Date(completedAt).getTime() - new Date(createdAt).getTime();

  // Calculate cycle time (first active work to completion)
  // "Active work" starts when card leaves backlog
  let firstActiveAt: string | undefined;
  if (card.columnHistory) {
    const backlogIds = new Set(
      columns.filter((c) => c.id === "backlog").map((c) => c.id)
    );
    const firstActiveTransition = card.columnHistory.find(
      (t) => t.from !== null && backlogIds.has(t.from) && !backlogIds.has(t.to)
    );
    if (firstActiveTransition) {
      firstActiveAt = firstActiveTransition.at;
    } else if (card.columnHistory.length > 0) {
      // If no backlog transition, use first transition
      const firstTransition = card.columnHistory.find((t) => t.from === null);
      if (firstTransition && !backlogIds.has(firstTransition.to)) {
        firstActiveAt = firstTransition.at;
      }
    }
  }

  const cycleTimeMs = firstActiveAt
    ? new Date(completedAt).getTime() - new Date(firstActiveAt).getTime()
    : leadTimeMs;

  const completedCardMetric: CompletedCardMetric = {
    cardId: card.id,
    title: card.title,
    createdAt,
    completedAt,
    leadTimeMs,
    cycleTimeMs,
    firstActiveAt,
  };

  const newCompletedCards = [completedCardMetric, ...metrics.completedCards].slice(
    0,
    MAX_COMPLETED_CARDS
  );

  return {
    ...metrics,
    completedCards: newCompletedCards,
  };
}

export function recordWipViolation(metrics: MetricsState): MetricsState {
  return {
    ...metrics,
    wipViolations: metrics.wipViolations + 1,
  };
}

export function takeDailySnapshot(
  cards: Card[],
  columns: Column[],
  metrics: MetricsState
): MetricsState {
  const today = new Date().toISOString().split("T")[0];

  // Don't take multiple snapshots per day
  if (metrics.lastSnapshotDate === today) {
    return metrics;
  }

  const columnCounts: Record<string, number> = {};
  for (const col of columns) {
    columnCounts[col.id] = cards.filter((c) => c.column === col.id).length;
  }

  const terminalColumns = new Set(columns.filter((c) => c.isTerminal).map((c) => c.id));
  const completedCount = cards.filter((c) => terminalColumns.has(c.column)).length;

  const snapshot: DailySnapshot = {
    date: today,
    columnCounts,
    completedCount,
    wipViolations: metrics.wipViolations,
  };

  const newSnapshots = [snapshot, ...metrics.dailySnapshots].slice(0, MAX_DAILY_SNAPSHOTS);

  return {
    ...metrics,
    dailySnapshots: newSnapshots,
    lastSnapshotDate: today,
  };
}

// Metrics calculations
export function calculateAverageLeadTime(metrics: MetricsState): number | null {
  if (metrics.completedCards.length === 0) return null;
  const total = metrics.completedCards.reduce((sum, c) => sum + c.leadTimeMs, 0);
  return total / metrics.completedCards.length;
}

export function calculateAverageCycleTime(metrics: MetricsState): number | null {
  if (metrics.completedCards.length === 0) return null;
  const total = metrics.completedCards.reduce((sum, c) => sum + c.cycleTimeMs, 0);
  return total / metrics.completedCards.length;
}

export function calculateThroughput(metrics: MetricsState, days: number = 7): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffTime = cutoff.getTime();

  const recentCompleted = metrics.completedCards.filter(
    (c) => new Date(c.completedAt).getTime() >= cutoffTime
  );

  return recentCompleted.length / (days / 7); // cards per week
}

export function formatDuration(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  const days = hours / 24;
  if (days < 7) {
    return `${days.toFixed(1)}d`;
  }
  const weeks = days / 7;
  return `${weeks.toFixed(1)}w`;
}
