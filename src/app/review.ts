import type { Card, Column, CompletedCardMetric, FocusSession, MetricsState } from "./types";
import { dateKey } from "./today";

export type DailyShutdownSummary = {
  date: string;
  completedToday: CompletedCardMetric[];
  focusSessionsToday: FocusSession[];
  slippedCards: Card[];
  blockedCards: Card[];
  staleCards: Card[];
  tomorrowCandidates: Card[];
  isComplete: boolean;
};

export type WeeklyReviewSummary = {
  weekKey: string;
  completedThisWeek: CompletedCardMetric[];
  focusSessionsThisWeek: FocusSession[];
  blockedCards: Card[];
  staleBacklog: Card[];
  proposedCommitments: Card[];
  isComplete: boolean;
};

type ReviewOptions = {
  now?: Date;
  staleDays?: number;
};

function cardDateKey(value?: string): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;
}

function startOfDay(date: Date): Date {
  return new Date(`${dateKey(date)}T00:00:00.000Z`);
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function weekKey(date: Date): string {
  return dateKey(startOfWeek(date));
}

function isBeforeDateKey(value: string | undefined, key: string): boolean {
  const candidate = cardDateKey(value);
  return candidate !== null && candidate < key;
}

function isTerminal(card: Card, terminalColumnIds: Set<string>): boolean {
  return terminalColumnIds.has(card.column);
}

function daysSince(value: string | undefined, now: Date): number {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

function activeCards(cards: Card[], columns: Column[]): Card[] {
  const terminalColumnIds = new Set(columns.filter((column) => column.isTerminal).map((column) => column.id));
  return cards.filter((card) => !card.archivedAt && !isTerminal(card, terminalColumnIds));
}

function sortByPriority(a: Card, b: Card): number {
  const aDue = cardDateKey(a.dueDate) ?? "9999-12-31";
  const bDue = cardDateKey(b.dueDate) ?? "9999-12-31";
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  return (a.order ?? 0) - (b.order ?? 0);
}

export function buildDailyShutdownSummary(
  cards: Card[],
  columns: Column[],
  metrics: MetricsState,
  options: ReviewOptions = {},
): DailyShutdownSummary {
  const now = options.now ?? new Date();
  const today = dateKey(now);
  const staleDays = options.staleDays ?? 7;
  const active = activeCards(cards, columns);

  const completedToday = metrics.completedCards.filter((card) => cardDateKey(card.completedAt) === today);
  const focusSessionsToday = (metrics.focusSessions ?? []).filter((session) => cardDateKey(session.endedAt) === today);
  const slippedCards = active.filter((card) => isBeforeDateKey(card.dueDate, today)).sort(sortByPriority);
  const blockedCards = active.filter((card) => card.column === "blocked" || !!card.blockedReason).sort(sortByPriority);
  const staleCards = active
    .filter((card) => daysSince(card.updatedAt || card.createdAt, now) >= staleDays)
    .sort(sortByPriority);
  const tomorrowCandidates = active
    .filter((card) => card.column !== "blocked")
    .sort((a, b) => {
      const aDoing = a.column === "doing" ? -1 : 0;
      const bDoing = b.column === "doing" ? -1 : 0;
      if (aDoing !== bDoing) return aDoing - bDoing;
      return sortByPriority(a, b);
    })
    .slice(0, 5);

  return {
    date: today,
    completedToday,
    focusSessionsToday,
    slippedCards,
    blockedCards,
    staleCards,
    tomorrowCandidates,
    isComplete: metrics.reviewMarkers?.dailyShutdownDate === today,
  };
}

export function buildWeeklyReviewSummary(
  cards: Card[],
  columns: Column[],
  metrics: MetricsState,
  options: ReviewOptions = {},
): WeeklyReviewSummary {
  const now = options.now ?? new Date();
  const staleDays = options.staleDays ?? 14;
  const start = startOfWeek(now);
  const week = dateKey(start);
  const active = activeCards(cards, columns);

  const completedThisWeek = metrics.completedCards.filter((card) => new Date(card.completedAt) >= start);
  const focusSessionsThisWeek = (metrics.focusSessions ?? []).filter((session) => new Date(session.endedAt) >= start);
  const blockedCards = active.filter((card) => card.column === "blocked" || !!card.blockedReason).sort(sortByPriority);
  const staleBacklog = active
    .filter((card) => card.column === "backlog" && daysSince(card.updatedAt || card.createdAt, now) >= staleDays)
    .sort(sortByPriority);
  const proposedCommitments = active
    .filter((card) => card.column !== "blocked")
    .sort(sortByPriority)
    .slice(0, 7);

  return {
    weekKey: week,
    completedThisWeek,
    focusSessionsThisWeek,
    blockedCards,
    staleBacklog,
    proposedCommitments,
    isComplete: metrics.reviewMarkers?.weeklyReviewWeek === week,
  };
}
