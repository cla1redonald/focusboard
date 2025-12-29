import { describe, it, expect, beforeEach } from "vitest";
import {
  loadMetrics,
  saveMetrics,
  recordCompletedCard,
  recordWipViolation,
  calculateAverageLeadTime,
  calculateAverageCycleTime,
  calculateThroughput,
  formatDuration,
  getStaleBacklogCards,
} from "./metrics";
import { DEFAULT_COLUMNS } from "./constants";
import type { Card, MetricsState, ColumnTransition } from "./types";

describe("metrics", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadMetrics", () => {
    it("returns default metrics when localStorage is empty", () => {
      const metrics = loadMetrics();

      expect(metrics.completedCards).toEqual([]);
      expect(metrics.dailySnapshots).toEqual([]);
      expect(metrics.wipViolations).toBe(0);
    });

    it("returns default metrics on invalid JSON", () => {
      localStorage.setItem("focusboard:metrics", "{{invalid}}");

      const metrics = loadMetrics();

      expect(metrics.completedCards).toEqual([]);
      expect(metrics.wipViolations).toBe(0);
    });

    it("loads persisted metrics", () => {
      const stored: MetricsState = {
        completedCards: [
          {
            cardId: "test-1",
            title: "Test Card",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: "2024-01-02T00:00:00.000Z",
            leadTimeMs: 86400000,
            cycleTimeMs: 43200000,
          },
        ],
        dailySnapshots: [],
        wipViolations: 5,
        currentStreak: 0,
        longestStreak: 0,
      };
      localStorage.setItem("focusboard:metrics", JSON.stringify(stored));

      const metrics = loadMetrics();

      expect(metrics.completedCards).toHaveLength(1);
      expect(metrics.completedCards[0].cardId).toBe("test-1");
      expect(metrics.wipViolations).toBe(5);
    });
  });

  describe("saveMetrics", () => {
    it("persists metrics to localStorage", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 10,
        currentStreak: 0,
        longestStreak: 0,
      };

      saveMetrics(metrics);

      const stored = localStorage.getItem("focusboard:metrics");
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.wipViolations).toBe(10);
    });
  });

  describe("recordCompletedCard", () => {
    it("adds completed card to metrics", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      const card: Card = {
        id: "card-1",
        column: "done",
        title: "Completed Card",
        order: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        completedAt: "2024-01-02T00:00:00.000Z",
        tags: [],
        checklist: [],
      };

      const updated = recordCompletedCard(card, DEFAULT_COLUMNS, metrics);

      expect(updated.completedCards).toHaveLength(1);
      expect(updated.completedCards[0].cardId).toBe("card-1");
      expect(updated.completedCards[0].title).toBe("Completed Card");
    });

    it("calculates lead time correctly", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      const card: Card = {
        id: "card-1",
        column: "done",
        title: "Test",
        order: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        completedAt: "2024-01-02T00:00:00.000Z",
        tags: [],
        checklist: [],
      };

      const updated = recordCompletedCard(card, DEFAULT_COLUMNS, metrics);

      // 1 day = 86400000 ms
      expect(updated.completedCards[0].leadTimeMs).toBe(86400000);
    });

    it("calculates cycle time from first non-backlog transition", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      const columnHistory: ColumnTransition[] = [
        { from: null, to: "backlog", at: "2024-01-01T00:00:00.000Z" },
        { from: "backlog", to: "todo", at: "2024-01-02T00:00:00.000Z" },
        { from: "todo", to: "doing", at: "2024-01-03T00:00:00.000Z" },
        { from: "doing", to: "done", at: "2024-01-04T00:00:00.000Z" },
      ];

      const card: Card = {
        id: "card-1",
        column: "done",
        title: "Test",
        order: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-04T00:00:00.000Z",
        completedAt: "2024-01-04T00:00:00.000Z",
        tags: [],
        checklist: [],
        columnHistory,
      };

      const updated = recordCompletedCard(card, DEFAULT_COLUMNS, metrics);

      // Cycle time: Jan 2 to Jan 4 = 2 days = 172800000 ms
      expect(updated.completedCards[0].cycleTimeMs).toBe(172800000);
      expect(updated.completedCards[0].firstActiveAt).toBe("2024-01-02T00:00:00.000Z");
    });

    it("limits completed cards to max 500", () => {
      const existingCards = Array.from({ length: 500 }, (_, i) => ({
        cardId: `card-${i}`,
        title: `Card ${i}`,
        createdAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-02T00:00:00.000Z",
        leadTimeMs: 86400000,
        cycleTimeMs: 86400000,
      }));

      const metrics: MetricsState = {
        completedCards: existingCards,
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      const card: Card = {
        id: "new-card",
        column: "done",
        title: "New Card",
        order: 0,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        completedAt: "2024-01-02T00:00:00.000Z",
        tags: [],
        checklist: [],
      };

      const updated = recordCompletedCard(card, DEFAULT_COLUMNS, metrics);

      expect(updated.completedCards).toHaveLength(500);
      expect(updated.completedCards[0].cardId).toBe("new-card");
    });
  });

  describe("recordWipViolation", () => {
    it("increments WIP violation count", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 5,
        currentStreak: 0,
        longestStreak: 0,
      };

      const updated = recordWipViolation(metrics);

      expect(updated.wipViolations).toBe(6);
    });
  });

  describe("calculateAverageLeadTime", () => {
    it("returns null when no completed cards", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      expect(calculateAverageLeadTime(metrics)).toBeNull();
    });

    it("calculates average correctly", () => {
      const metrics: MetricsState = {
        completedCards: [
          {
            cardId: "1",
            title: "Card 1",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: "2024-01-02T00:00:00.000Z",
            leadTimeMs: 100000,
            cycleTimeMs: 50000,
          },
          {
            cardId: "2",
            title: "Card 2",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: "2024-01-02T00:00:00.000Z",
            leadTimeMs: 200000,
            cycleTimeMs: 100000,
          },
        ],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      expect(calculateAverageLeadTime(metrics)).toBe(150000);
    });
  });

  describe("calculateAverageCycleTime", () => {
    it("returns null when no completed cards", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      expect(calculateAverageCycleTime(metrics)).toBeNull();
    });

    it("calculates average correctly", () => {
      const metrics: MetricsState = {
        completedCards: [
          {
            cardId: "1",
            title: "Card 1",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: "2024-01-02T00:00:00.000Z",
            leadTimeMs: 100000,
            cycleTimeMs: 50000,
          },
          {
            cardId: "2",
            title: "Card 2",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: "2024-01-02T00:00:00.000Z",
            leadTimeMs: 200000,
            cycleTimeMs: 100000,
          },
        ],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      expect(calculateAverageCycleTime(metrics)).toBe(75000);
    });
  });

  describe("calculateThroughput", () => {
    it("returns 0 when no completed cards", () => {
      const metrics: MetricsState = {
        completedCards: [],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      expect(calculateThroughput(metrics)).toBe(0);
    });

    it("calculates weekly throughput correctly", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const metrics: MetricsState = {
        completedCards: [
          {
            cardId: "1",
            title: "Card 1",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: yesterday.toISOString(),
            leadTimeMs: 100000,
            cycleTimeMs: 50000,
          },
          {
            cardId: "2",
            title: "Card 2",
            createdAt: "2024-01-01T00:00:00.000Z",
            completedAt: yesterday.toISOString(),
            leadTimeMs: 100000,
            cycleTimeMs: 50000,
          },
        ],
        dailySnapshots: [],
        wipViolations: 0,
        currentStreak: 0,
        longestStreak: 0,
      };

      // 2 cards in 7 days = 2 per week
      expect(calculateThroughput(metrics)).toBe(2);
    });
  });

  describe("formatDuration", () => {
    it("formats hours correctly", () => {
      expect(formatDuration(1000 * 60 * 60)).toBe("1h");
      expect(formatDuration(1000 * 60 * 60 * 12)).toBe("12h");
    });

    it("formats days correctly", () => {
      expect(formatDuration(1000 * 60 * 60 * 24)).toBe("1.0d");
      expect(formatDuration(1000 * 60 * 60 * 36)).toBe("1.5d");
    });

    it("formats weeks correctly", () => {
      expect(formatDuration(1000 * 60 * 60 * 24 * 7)).toBe("1.0w");
      expect(formatDuration(1000 * 60 * 60 * 24 * 14)).toBe("2.0w");
    });
  });

  describe("getStaleBacklogCards", () => {
    function daysAgo(days: number): string {
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString();
    }

    function createCard(id: string, column: string, updatedAt: string, dueDate?: string): Card {
      return {
        id,
        column,
        title: `Card ${id}`,
        order: 0,
        createdAt: daysAgo(30),
        updatedAt,
        tags: [],
        checklist: [],
        dueDate,
      };
    }

    it("returns empty array when no backlog cards", () => {
      const cards = [
        createCard("1", "todo", daysAgo(10)),
        createCard("2", "doing", daysAgo(10)),
      ];
      const result = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result).toHaveLength(0);
    });

    it("returns stale backlog cards without due dates", () => {
      const cards = [
        createCard("1", "backlog", daysAgo(10)),
        createCard("2", "backlog", daysAgo(3)),
      ];
      const result = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result).toHaveLength(1);
      expect(result[0].card.id).toBe("1");
    });

    it("excludes backlog cards with due dates", () => {
      const cards = [
        createCard("1", "backlog", daysAgo(10), daysAgo(-5)), // has due date in future
        createCard("2", "backlog", daysAgo(10)),
      ];
      const result = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result).toHaveLength(1);
      expect(result[0].card.id).toBe("2");
    });

    it("respects threshold parameter", () => {
      const cards = [
        createCard("1", "backlog", daysAgo(5)),
        createCard("2", "backlog", daysAgo(10)),
      ];

      const result3 = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 3);
      expect(result3).toHaveLength(2);

      const result7 = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result7).toHaveLength(1);

      const result14 = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 14);
      expect(result14).toHaveLength(0);
    });

    it("includes daysSinceUpdate in result", () => {
      const cards = [
        createCard("1", "backlog", daysAgo(10)),
      ];
      const result = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result[0].daysSinceUpdate).toBeGreaterThanOrEqual(9);
      expect(result[0].daysSinceUpdate).toBeLessThanOrEqual(11);
    });

    it("includes column title in result", () => {
      const cards = [
        createCard("1", "backlog", daysAgo(10)),
      ];
      const result = getStaleBacklogCards(cards, DEFAULT_COLUMNS, 7);
      expect(result[0].columnTitle).toBe("Backlog");
    });
  });
});
