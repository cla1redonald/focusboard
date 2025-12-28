import type {
  Card,
  Column,
  CompletedCardMetric,
  MetricsState,
  DailySnapshot,
  StaleCard,
  ColumnAgeStats,
  CycleTimeBucket,
  BlockedTimeStats,
  CFDDataPoint,
  CardAgeLevel,
} from "./types";

const METRICS_KEY = "focusboard:metrics";
const MAX_COMPLETED_CARDS = 500;
const MAX_DAILY_SNAPSHOTS = 90;

const DEFAULT_METRICS: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
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
      currentStreak: parsed.currentStreak ?? 0,
      longestStreak: parsed.longestStreak ?? 0,
      lastCompletionDate: parsed.lastCompletionDate,
    };
  } catch {
    return DEFAULT_METRICS;
  }
}

export function saveMetrics(metrics: MetricsState): void {
  localStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
}

function getDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDaysDifference(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

export function updateStreak(metrics: MetricsState): MetricsState {
  const today = getDateString(new Date());
  const lastDate = metrics.lastCompletionDate;

  // Already completed something today - no change
  if (lastDate === today) {
    return metrics;
  }

  let newStreak: number;

  if (!lastDate) {
    // First ever completion
    newStreak = 1;
  } else {
    const daysDiff = getDaysDifference(lastDate, today);
    if (daysDiff === 1) {
      // Consecutive day - extend streak
      newStreak = metrics.currentStreak + 1;
    } else {
      // Streak broken - start fresh
      newStreak = 1;
    }
  }

  const newLongest = Math.max(metrics.longestStreak, newStreak);

  return {
    ...metrics,
    currentStreak: newStreak,
    longestStreak: newLongest,
    lastCompletionDate: today,
  };
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

  // Update streak when a card is completed
  const withStreak = updateStreak(metrics);

  return {
    ...withStreak,
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

// ============================================
// Analytics Utility Functions
// ============================================

/**
 * Get cards that haven't been updated in X days
 * Only considers cards in active columns (not backlog or terminal)
 */
export function getStaleCards(
  cards: Card[],
  columns: Column[],
  thresholdDays: number
): StaleCard[] {
  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;

  // Get active column IDs (not backlog, not terminal)
  const activeColumnIds = new Set(
    columns
      .filter((c) => c.id !== "backlog" && !c.isTerminal)
      .map((c) => c.id)
  );

  const columnMap = new Map(columns.map((c) => [c.id, c.title]));

  return cards
    .filter((card) => {
      if (!activeColumnIds.has(card.column)) return false;
      const lastUpdate = new Date(card.updatedAt).getTime();
      return now - lastUpdate >= thresholdMs;
    })
    .map((card) => ({
      card,
      columnTitle: columnMap.get(card.column) ?? card.column,
      daysSinceUpdate: Math.floor(
        (now - new Date(card.updatedAt).getTime()) / (24 * 60 * 60 * 1000)
      ),
    }))
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate);
}

/**
 * Get age statistics for each active column
 * Age = time since card entered that column
 */
export function getColumnAgeStats(cards: Card[], columns: Column[]): ColumnAgeStats[] {
  const now = Date.now();
  const activeColumns = columns.filter((c) => c.id !== "backlog" && !c.isTerminal);

  return activeColumns.map((column) => {
    const columnCards = cards.filter((c) => c.column === column.id);

    if (columnCards.length === 0) {
      return {
        columnId: column.id,
        columnTitle: column.title,
        columnColor: column.color,
        cardCount: 0,
        avgAgeMs: 0,
        maxAgeMs: 0,
      };
    }

    // Calculate age = time since card entered this column (from columnHistory)
    const ages = columnCards.map((card) => {
      const lastTransition = card.columnHistory
        ?.filter((t) => t.to === column.id)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

      if (lastTransition) {
        return now - new Date(lastTransition.at).getTime();
      }
      // Fallback to createdAt if no history
      return now - new Date(card.createdAt).getTime();
    });

    const maxAgeMs = Math.max(...ages);
    const avgAgeMs = ages.reduce((a, b) => a + b, 0) / ages.length;
    const oldestIdx = ages.indexOf(maxAgeMs);

    return {
      columnId: column.id,
      columnTitle: column.title,
      columnColor: column.color,
      cardCount: columnCards.length,
      avgAgeMs,
      maxAgeMs,
      oldestCardTitle: columnCards[oldestIdx]?.title,
    };
  });
}

/**
 * Get cycle time distribution in buckets
 */
export function getCycleTimeDistribution(metrics: MetricsState): CycleTimeBucket[] {
  const buckets = [
    { label: "<1d", maxMs: 1 * 24 * 60 * 60 * 1000, count: 0 },
    { label: "1-3d", maxMs: 3 * 24 * 60 * 60 * 1000, count: 0 },
    { label: "3-7d", maxMs: 7 * 24 * 60 * 60 * 1000, count: 0 },
    { label: "7-14d", maxMs: 14 * 24 * 60 * 60 * 1000, count: 0 },
    { label: ">14d", maxMs: Infinity, count: 0 },
  ];

  const total = metrics.completedCards.length;
  if (total === 0) return [];

  for (const card of metrics.completedCards) {
    const cycleTime = card.cycleTimeMs;
    for (const bucket of buckets) {
      if (cycleTime <= bucket.maxMs) {
        bucket.count++;
        break;
      }
    }
  }

  return buckets.map((b, idx) => ({
    label: b.label,
    rangeLabel:
      idx === 0
        ? "Under 1 day"
        : idx === 4
          ? "Over 14 days"
          : b.label.replace("-", " to ").replace(/d$/, " days"),
    count: b.count,
    percentage: (b.count / total) * 100,
  }));
}

/**
 * Get blocked time analysis
 */
export function getBlockedTimeAnalysis(
  cards: Card[],
  _metrics: MetricsState
): BlockedTimeStats {
  const now = Date.now();
  const blockedColumnId = "blocked";

  // Currently blocked cards
  const currentlyBlocked = cards
    .filter((c) => c.column === blockedColumnId)
    .map((card) => {
      const lastBlockedTransition = card.columnHistory
        ?.filter((t) => t.to === blockedColumnId)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];

      const blockedCount =
        card.columnHistory?.filter((t) => t.to === blockedColumnId).length ?? 0;

      return {
        card,
        blockedSinceMs: lastBlockedTransition
          ? now - new Date(lastBlockedTransition.at).getTime()
          : 0,
        blockedCount,
      };
    })
    .sort((a, b) => b.blockedSinceMs - a.blockedSinceMs);

  // Calculate average blocked time from cards with history
  let totalBlockedTime = 0;
  let blockedPeriodCount = 0;

  // Find cards that were blocked multiple times
  const blockCounts = new Map<string, { title: string; count: number }>();

  for (const card of cards) {
    if (card.columnHistory) {
      const blockTransitions = card.columnHistory.filter(
        (t) => t.to === blockedColumnId
      );
      if (blockTransitions.length > 1) {
        blockCounts.set(card.id, {
          title: card.title,
          count: blockTransitions.length,
        });
      }

      // Calculate time spent blocked
      for (let i = 0; i < card.columnHistory.length; i++) {
        const t = card.columnHistory[i];
        if (t.to === blockedColumnId) {
          const nextTransition = card.columnHistory.find(
            (nt, j) => j > i && nt.from === blockedColumnId
          );
          if (nextTransition) {
            totalBlockedTime +=
              new Date(nextTransition.at).getTime() - new Date(t.at).getTime();
            blockedPeriodCount++;
          }
        }
      }
    }
  }

  const frequentlyBlocked = Array.from(blockCounts.entries())
    .map(([cardId, { title, count }]) => ({ cardId, title, blockCount: count }))
    .sort((a, b) => b.blockCount - a.blockCount)
    .slice(0, 5);

  return {
    avgBlockedTimeMs:
      blockedPeriodCount > 0 ? totalBlockedTime / blockedPeriodCount : 0,
    currentlyBlocked,
    frequentlyBlocked,
  };
}

/**
 * Get cumulative flow diagram data from daily snapshots
 */
export function getCumulativeFlowData(
  snapshots: DailySnapshot[],
  columns: Column[],
  days: 30 | 60 | 90
): CFDDataPoint[] {
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const relevantSnapshots = snapshots
    .filter((s) => new Date(s.date) >= cutoffDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return relevantSnapshots.map((snapshot) => {
    const cumulativeCounts: Record<string, number> = {};
    let cumulative = 0;

    // Build cumulative counts from bottom to top
    for (const col of sortedColumns) {
      const count = snapshot.columnCounts[col.id] ?? 0;
      cumulative += count;
      cumulativeCounts[col.id] = cumulative;
    }

    return {
      date: snapshot.date,
      columns: snapshot.columnCounts,
      cumulativeCounts,
    };
  });
}

/**
 * Get card age level for WIP indicators
 */
export function getCardAgeLevel(card: Card): CardAgeLevel {
  const now = Date.now();
  const lastUpdate = new Date(card.updatedAt).getTime();
  const daysSinceUpdate = (now - lastUpdate) / (24 * 60 * 60 * 1000);

  if (daysSinceUpdate >= 14) return "red";
  if (daysSinceUpdate >= 7) return "orange";
  if (daysSinceUpdate >= 3) return "yellow";
  return "none";
}

/**
 * Get number of days since card was last updated
 */
export function getCardAgeDays(card: Card): number {
  const now = Date.now();
  const lastUpdate = new Date(card.updatedAt).getTime();
  return Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000));
}
