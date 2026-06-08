import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS } from "./constants";
import { buildTodayDailyPlan, buildTodayPlan, dateKey } from "./today";
import type { Card } from "./types";

const now = new Date("2026-06-08T12:00:00.000Z");

function card(overrides: Partial<Card>): Card {
  return {
    id: overrides.id ?? "card",
    column: overrides.column ?? "backlog",
    title: overrides.title ?? "Card",
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-01T09:00:00.000Z",
    tags: [],
    checklist: [],
    ...overrides,
  };
}

describe("buildTodayPlan", () => {
  it("prioritizes in-progress, overdue, and due-today cards", () => {
    const plan = buildTodayPlan(
      [
        card({ id: "doing", title: "Current", column: "doing", order: 0 }),
        card({ id: "overdue", title: "Late", column: "todo", dueDate: "2026-06-07", order: 1 }),
        card({ id: "today", title: "Today", column: "todo", dueDate: "2026-06-08", order: 2 }),
      ],
      DEFAULT_COLUMNS,
      { now },
    );

    expect(plan.recommendations.map((item) => item.card.id)).toEqual(["doing", "overdue", "today"]);
    expect(plan.attention.overdue.map((item) => item.id)).toEqual(["overdue"]);
    expect(plan.attention.dueToday.map((item) => item.id)).toEqual(["today"]);
  });

  it("excludes terminal and archived cards from active recommendations", () => {
    const plan = buildTodayPlan(
      [
        card({ id: "done", column: "done", dueDate: "2026-06-08" }),
        card({ id: "archived", column: "todo", dueDate: "2026-06-08", archivedAt: "2026-06-08T10:00:00.000Z" }),
      ],
      DEFAULT_COLUMNS,
      { now },
    );

    expect(plan.activeCount).toBe(0);
    expect(plan.recommendations).toEqual([]);
  });

  it("keeps blocked cards in attention but out of recommended focus", () => {
    const plan = buildTodayPlan(
      [
        card({ id: "blocked", column: "blocked", title: "Waiting", blockedReason: "Need answer", dueDate: "2026-06-08" }),
      ],
      DEFAULT_COLUMNS,
      { now },
    );

    expect(plan.attention.blocked.map((item) => item.id)).toEqual(["blocked"]);
    expect(plan.recommendations).toEqual([]);
  });

  it("detects stale backlog cards without dates", () => {
    const plan = buildTodayPlan(
      [
        card({ id: "stale", column: "backlog", updatedAt: "2026-05-28T09:00:00.000Z" }),
      ],
      DEFAULT_COLUMNS,
      { now, staleBacklogThreshold: 7 },
    );

    expect(plan.attention.stale.map((item) => item.id)).toEqual(["stale"]);
    expect(plan.recommendations[0].reasons.map((r) => r.kind)).toContain("stale");
  });

  it("reports WIP pressure for full columns", () => {
    const plan = buildTodayPlan(
      [
        card({ id: "doing-1", column: "doing" }),
        card({ id: "doing-2", column: "doing", order: 1 }),
        card({ id: "doing-3", column: "doing", order: 2 }),
      ],
      DEFAULT_COLUMNS,
      { now },
    );

    expect(plan.wipPressure).toEqual([
      expect.objectContaining({
        count: 3,
        limit: 3,
        column: expect.objectContaining({ id: "doing" }),
      }),
    ]);
    expect(plan.recommendations[0].reasons.map((r) => r.kind)).toContain("wip-pressure");
  });
});

describe("dateKey", () => {
  it("formats the local calendar day", () => {
    expect(dateKey(now)).toBe("2026-06-08");
  });
});

describe("buildTodayDailyPlan", () => {
  it("resolves today's main and support cards with progress", () => {
    const plan = buildTodayDailyPlan(
      {
        date: "2026-06-08",
        mainCardId: "main",
        supportCardIds: ["support", "done"],
        createdAt: "2026-06-08T08:00:00.000Z",
        updatedAt: "2026-06-08T08:00:00.000Z",
      },
      [
        card({ id: "main", title: "Main", column: "doing" }),
        card({ id: "support", title: "Support", column: "todo" }),
        card({ id: "done", title: "Done", column: "done" }),
      ],
      DEFAULT_COLUMNS,
      now,
    );

    expect(plan.main?.id).toBe("main");
    expect(plan.support.map((item) => item.id)).toEqual(["support", "done"]);
    expect(plan.plannedCardIds).toEqual(["main", "support", "done"]);
    expect(plan.completedCount).toBe(1);
    expect(plan.plannedCount).toBe(3);
  });

  it("ignores stale plans from previous days", () => {
    const plan = buildTodayDailyPlan(
      {
        date: "2026-06-07",
        mainCardId: "main",
        supportCardIds: ["support"],
        createdAt: "2026-06-07T08:00:00.000Z",
        updatedAt: "2026-06-07T08:00:00.000Z",
      },
      [card({ id: "main" }), card({ id: "support" })],
      DEFAULT_COLUMNS,
      now,
    );

    expect(plan.main).toBeNull();
    expect(plan.support).toEqual([]);
    expect(plan.plannedCount).toBe(0);
  });

  it("drops archived and missing cards from the plan", () => {
    const plan = buildTodayDailyPlan(
      {
        date: "2026-06-08",
        mainCardId: "archived",
        supportCardIds: ["missing", "support"],
        createdAt: "2026-06-08T08:00:00.000Z",
        updatedAt: "2026-06-08T08:00:00.000Z",
      },
      [
        card({ id: "archived", archivedAt: "2026-06-08T09:00:00.000Z" }),
        card({ id: "support" }),
      ],
      DEFAULT_COLUMNS,
      now,
    );

    expect(plan.main).toBeNull();
    expect(plan.support.map((item) => item.id)).toEqual(["support"]);
    expect(plan.plannedCardIds).toEqual(["support"]);
  });
});
