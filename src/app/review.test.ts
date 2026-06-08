import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS } from "./constants";
import { buildDailyShutdownSummary, buildWeeklyReviewSummary, weekKey } from "./review";
import type { Card, MetricsState } from "./types";

function card(overrides: Partial<Card>): Card {
  return {
    id: overrides.id ?? "card",
    column: overrides.column ?? "todo",
    title: overrides.title ?? "Card",
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T09:00:00.000Z",
    tags: [],
    checklist: [],
    ...overrides,
  };
}

const metrics: MetricsState = {
  completedCards: [
    {
      cardId: "done-today",
      title: "Done today",
      createdAt: "2026-06-01T09:00:00.000Z",
      completedAt: "2026-06-08T10:00:00.000Z",
      leadTimeMs: 1000,
      cycleTimeMs: 1000,
    },
  ],
  dailySnapshots: [],
  focusSessions: [
    {
      id: "focus-1",
      cardId: "doing",
      cardTitle: "Active work",
      plannedMinutes: 25,
      startedAt: "2026-06-08T09:00:00.000Z",
      endedAt: "2026-06-08T09:25:00.000Z",
      outcome: "progressed",
    },
  ],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

describe("review selectors", () => {
  it("builds a daily shutdown summary", () => {
    const summary = buildDailyShutdownSummary(
      [
        card({ id: "doing", title: "Active work", column: "doing" }),
        card({ id: "slipped", title: "Slipped", dueDate: "2026-06-07" }),
        card({ id: "blocked", title: "Blocked", column: "blocked", blockedReason: "Waiting" }),
        card({ id: "done", title: "Terminal", column: "done" }),
      ],
      DEFAULT_COLUMNS,
      metrics,
      { now: new Date("2026-06-08T12:00:00.000Z") },
    );

    expect(summary.completedToday.map((item) => item.cardId)).toEqual(["done-today"]);
    expect(summary.focusSessionsToday).toHaveLength(1);
    expect(summary.slippedCards.map((item) => item.id)).toEqual(["slipped"]);
    expect(summary.blockedCards.map((item) => item.id)).toEqual(["blocked"]);
    expect(summary.tomorrowCandidates.map((item) => item.id)).toContain("doing");
    expect(summary.tomorrowCandidates.map((item) => item.id)).not.toContain("done");
  });

  it("marks daily shutdown complete for the current local date key", () => {
    const now = new Date("2026-06-08T12:00:00.000Z");
    const summary = buildDailyShutdownSummary([], DEFAULT_COLUMNS, {
      ...metrics,
      reviewMarkers: { dailyShutdownDate: "2026-06-08" },
    }, { now });

    expect(summary.isComplete).toBe(true);
  });

  it("builds a weekly review summary", () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    const summary = buildWeeklyReviewSummary(
      [
        card({ id: "backlog-stale", title: "Old backlog", column: "backlog", updatedAt: "2026-05-20T09:00:00.000Z" }),
        card({ id: "next", title: "Next commitment", dueDate: "2026-06-11" }),
        card({ id: "blocked", title: "Blocked", column: "blocked" }),
      ],
      DEFAULT_COLUMNS,
      metrics,
      { now },
    );

    expect(summary.weekKey).toBe(weekKey(now));
    expect(summary.completedThisWeek).toHaveLength(1);
    expect(summary.focusSessionsThisWeek).toHaveLength(1);
    expect(summary.staleBacklog.map((item) => item.id)).toEqual(["backlog-stale"]);
    expect(summary.proposedCommitments.map((item) => item.id)).toContain("next");
    expect(summary.proposedCommitments.map((item) => item.id)).not.toContain("blocked");
  });
});
