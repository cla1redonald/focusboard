import type { Card, Column, ColumnId } from "./types";

export type TodayReasonKind =
  | "doing"
  | "overdue"
  | "due-today"
  | "due-soon"
  | "blocked"
  | "stale"
  | "wip-pressure";

export type TodayReason = {
  kind: TodayReasonKind;
  label: string;
  weight: number;
};

export type TodayRecommendation = {
  card: Card;
  reasons: TodayReason[];
  score: number;
};

export type TodayAttention = {
  overdue: Card[];
  dueToday: Card[];
  blocked: Card[];
  stale: Card[];
};

export type TodayWipPressure = {
  column: Column;
  count: number;
  limit: number;
  cards: Card[];
};

export type TodayPlan = {
  recommendations: TodayRecommendation[];
  attention: TodayAttention;
  wipPressure: TodayWipPressure[];
  activeCount: number;
};

type BuildTodayPlanOptions = {
  now?: Date;
  maxRecommendations?: number;
  staleBacklogThreshold?: 3 | 7 | 14;
};

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromCardDate(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function dayDiffFromToday(value: string | undefined, now: Date): number | null {
  const key = dateKeyFromCardDate(value);
  if (!key) return null;

  const today = new Date(`${dateKey(now)}T00:00:00.000Z`);
  const due = new Date(`${key}T00:00:00.000Z`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function daysSince(value: string | undefined, now: Date): number {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

function isTerminal(card: Card, terminalColumnIds: Set<ColumnId>): boolean {
  return terminalColumnIds.has(card.column);
}

function reason(kind: TodayReasonKind, label: string, weight: number): TodayReason {
  return { kind, label, weight };
}

export function buildTodayPlan(
  cards: Card[],
  columns: Column[],
  options: BuildTodayPlanOptions = {},
): TodayPlan {
  const now = options.now ?? new Date();
  const maxRecommendations = options.maxRecommendations ?? 5;
  const staleBacklogThreshold = options.staleBacklogThreshold ?? 7;
  const terminalColumnIds = new Set(columns.filter((column) => column.isTerminal).map((column) => column.id));

  const activeCards = cards.filter((card) => !card.archivedAt && !isTerminal(card, terminalColumnIds));

  const overdue: Card[] = [];
  const dueToday: Card[] = [];
  const blocked: Card[] = [];
  const stale: Card[] = [];
  const recommendations: TodayRecommendation[] = [];

  const columnCards = new Map<ColumnId, Card[]>();
  for (const column of columns) {
    columnCards.set(column.id, []);
  }
  for (const card of activeCards) {
    columnCards.get(card.column)?.push(card);
  }

  const pressureColumnIds = new Set<ColumnId>();
  const wipPressure: TodayWipPressure[] = columns
    .filter((column) => column.wipLimit !== null)
    .map((column) => {
      const inColumn = columnCards.get(column.id) ?? [];
      const limit = column.wipLimit ?? 0;
      return { column, count: inColumn.length, limit, cards: inColumn };
    })
    .filter((pressure) => {
      const isPressure = pressure.limit > 0 && pressure.count >= pressure.limit;
      if (isPressure) pressureColumnIds.add(pressure.column.id);
      return isPressure;
    });

  for (const card of activeCards) {
    const cardReasons: TodayReason[] = [];
    const diff = dayDiffFromToday(card.dueDate, now);

    if (card.column === "doing") {
      cardReasons.push(reason("doing", "Already in progress", 80));
    }
    if (card.blockedReason || card.column === "blocked") {
      blocked.push(card);
      cardReasons.push(reason("blocked", "Blocked", 45));
    }
    if (diff !== null && diff < 0) {
      overdue.push(card);
      cardReasons.push(reason("overdue", "Overdue", 70));
    } else if (diff === 0) {
      dueToday.push(card);
      cardReasons.push(reason("due-today", "Due today", 65));
    } else if (diff !== null && diff <= 3) {
      cardReasons.push(reason("due-soon", `Due in ${diff} day${diff === 1 ? "" : "s"}`, 40 - diff));
    }

    if (card.column === "backlog" && !card.dueDate && daysSince(card.updatedAt || card.createdAt, now) >= staleBacklogThreshold) {
      stale.push(card);
      cardReasons.push(reason("stale", "Stale backlog", 20));
    }

    if (wipPressure.length > 0 && pressureColumnIds.has(card.column)) {
      cardReasons.push(reason("wip-pressure", "WIP pressure", 18));
    }

    if (cardReasons.length > 0 && !cardReasons.some((r) => r.kind === "blocked")) {
      const score = cardReasons.reduce((sum, r) => sum + r.weight, 0);
      recommendations.push({ card, reasons: cardReasons, score });
    }
  }

  recommendations.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.card.order ?? 0) - (b.card.order ?? 0);
  });

  const sortByOrder = (a: Card, b: Card) => (a.order ?? 0) - (b.order ?? 0);

  return {
    recommendations: recommendations.slice(0, maxRecommendations),
    attention: {
      overdue: overdue.sort(sortByOrder),
      dueToday: dueToday.sort(sortByOrder),
      blocked: blocked.sort(sortByOrder),
      stale: stale.sort(sortByOrder),
    },
    wipPressure,
    activeCount: activeCards.length,
  };
}
