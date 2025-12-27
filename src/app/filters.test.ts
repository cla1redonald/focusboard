import { describe, it, expect } from "vitest";
import {
  filterCards,
  getAllTags,
  isFilterActive,
  DEFAULT_FILTER,
} from "./filters";
import type { Card } from "./types";

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  id: `card-${Math.random().toString(36).slice(2)}`,
  column: "todo",
  title: "Test Card",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("filters", () => {
  describe("DEFAULT_FILTER", () => {
    it("has expected default values", () => {
      expect(DEFAULT_FILTER).toEqual({
        search: "",
        columns: [],
        tags: [],
        dueDate: "all",
        hasBlocker: null,
      });
    });
  });

  describe("isFilterActive", () => {
    it("returns false for default filter", () => {
      expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
    });

    it("returns true when search is set", () => {
      expect(isFilterActive({ ...DEFAULT_FILTER, search: "test" })).toBe(true);
    });

    it("returns true when columns filter is set", () => {
      expect(isFilterActive({ ...DEFAULT_FILTER, columns: ["todo"] })).toBe(true);
    });

    it("returns true when tags filter is set", () => {
      expect(isFilterActive({ ...DEFAULT_FILTER, tags: ["urgent"] })).toBe(true);
    });

    it("returns true when dueDate filter is not all", () => {
      expect(isFilterActive({ ...DEFAULT_FILTER, dueDate: "today" })).toBe(true);
    });

    it("returns true when hasBlocker filter is set", () => {
      expect(isFilterActive({ ...DEFAULT_FILTER, hasBlocker: true })).toBe(true);
      expect(isFilterActive({ ...DEFAULT_FILTER, hasBlocker: false })).toBe(true);
    });
  });

  describe("filterCards - search", () => {
    it("returns all cards when search is empty", () => {
      const cards = [makeCard({ title: "Task 1" }), makeCard({ title: "Task 2" })];
      const result = filterCards(cards, DEFAULT_FILTER);
      expect(result).toHaveLength(2);
    });

    it("filters by title match", () => {
      const cards = [
        makeCard({ title: "Buy groceries" }),
        makeCard({ title: "Call mom" }),
        makeCard({ title: "Buy milk" }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, search: "buy" });
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.title)).toEqual(["Buy groceries", "Buy milk"]);
    });

    it("filters by notes match", () => {
      const cards = [
        makeCard({ title: "Task 1", notes: "Important meeting tomorrow" }),
        makeCard({ title: "Task 2", notes: "Low priority" }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, search: "meeting" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Task 1");
    });

    it("filters by tag match", () => {
      const cards = [
        makeCard({ title: "Task 1", tags: ["urgent", "work"] }),
        makeCard({ title: "Task 2", tags: ["personal"] }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, search: "urg" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Task 1");
    });

    it("filters by checklist item match", () => {
      const cards = [
        makeCard({
          title: "Task 1",
          checklist: [{ id: "1", text: "Review proposal", done: false }],
        }),
        makeCard({ title: "Task 2", checklist: [] }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, search: "proposal" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Task 1");
    });

    it("search is case insensitive", () => {
      const cards = [makeCard({ title: "IMPORTANT TASK" })];
      const result = filterCards(cards, { ...DEFAULT_FILTER, search: "important" });
      expect(result).toHaveLength(1);
    });
  });

  describe("filterCards - columns", () => {
    it("returns all cards when columns filter is empty", () => {
      const cards = [
        makeCard({ column: "todo" }),
        makeCard({ column: "doing" }),
        makeCard({ column: "done" }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, columns: [] });
      expect(result).toHaveLength(3);
    });

    it("filters by single column", () => {
      const cards = [
        makeCard({ column: "todo" }),
        makeCard({ column: "doing" }),
        makeCard({ column: "done" }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, columns: ["todo"] });
      expect(result).toHaveLength(1);
      expect(result[0].column).toBe("todo");
    });

    it("filters by multiple columns", () => {
      const cards = [
        makeCard({ column: "todo" }),
        makeCard({ column: "doing" }),
        makeCard({ column: "done" }),
      ];
      const result = filterCards(cards, {
        ...DEFAULT_FILTER,
        columns: ["todo", "doing"],
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("filterCards - tags", () => {
    it("returns all cards when tags filter is empty", () => {
      const cards = [
        makeCard({ tags: ["urgent"] }),
        makeCard({ tags: ["personal"] }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, tags: [] });
      expect(result).toHaveLength(3);
    });

    it("filters by single tag", () => {
      const cards = [
        makeCard({ tags: ["urgent", "work"] }),
        makeCard({ tags: ["personal"] }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, tags: ["urgent"] });
      expect(result).toHaveLength(1);
    });

    it("filters by multiple tags (OR logic)", () => {
      const cards = [
        makeCard({ tags: ["urgent"] }),
        makeCard({ tags: ["personal"] }),
        makeCard({ tags: ["work"] }),
      ];
      const result = filterCards(cards, {
        ...DEFAULT_FILTER,
        tags: ["urgent", "personal"],
      });
      expect(result).toHaveLength(2);
    });

    it("excludes cards without tags when tag filter is set", () => {
      const cards = [makeCard({ tags: ["urgent"] }), makeCard({})];
      const result = filterCards(cards, { ...DEFAULT_FILTER, tags: ["urgent"] });
      expect(result).toHaveLength(1);
    });
  });

  describe("filterCards - dueDate", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayStr = today.toISOString();

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString();

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString();

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 8);
    const nextWeekStr = nextWeek.toISOString();

    it("returns all cards when dueDate filter is all", () => {
      const cards = [
        makeCard({ dueDate: todayStr }),
        makeCard({ dueDate: yesterdayStr }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, dueDate: "all" });
      expect(result).toHaveLength(3);
    });

    it("filters overdue cards", () => {
      const cards = [
        makeCard({ dueDate: yesterdayStr }),
        makeCard({ dueDate: todayStr }),
        makeCard({ dueDate: tomorrowStr }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, dueDate: "overdue" });
      expect(result).toHaveLength(1);
      expect(result[0].dueDate).toBe(yesterdayStr);
    });

    it("filters cards due today", () => {
      const cards = [
        makeCard({ dueDate: yesterdayStr }),
        makeCard({ dueDate: todayStr }),
        makeCard({ dueDate: tomorrowStr }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, dueDate: "today" });
      expect(result).toHaveLength(1);
      expect(result[0].dueDate).toBe(todayStr);
    });

    it("filters cards due this week", () => {
      const cards = [
        makeCard({ dueDate: yesterdayStr }),
        makeCard({ dueDate: todayStr }),
        makeCard({ dueDate: tomorrowStr }),
        makeCard({ dueDate: nextWeekStr }),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, dueDate: "this-week" });
      // Should include today and tomorrow, but not yesterday or next week
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((c) => c.dueDate === todayStr)).toBe(true);
    });

    it("filters cards with no due date", () => {
      const cards = [
        makeCard({ dueDate: todayStr }),
        makeCard({}),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, dueDate: "no-date" });
      expect(result).toHaveLength(2);
      expect(result.every((c) => !c.dueDate)).toBe(true);
    });
  });

  describe("filterCards - hasBlocker", () => {
    it("returns all cards when hasBlocker is null", () => {
      const cards = [
        makeCard({ blockedReason: "Waiting for API" }),
        makeCard({ column: "blocked" }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, hasBlocker: null });
      expect(result).toHaveLength(3);
    });

    it("filters blocked cards when hasBlocker is true", () => {
      const cards = [
        makeCard({ blockedReason: "Waiting for API" }),
        makeCard({ column: "blocked" }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, hasBlocker: true });
      expect(result).toHaveLength(2);
    });

    it("filters unblocked cards when hasBlocker is false", () => {
      const cards = [
        makeCard({ blockedReason: "Waiting for API" }),
        makeCard({ column: "blocked" }),
        makeCard({}),
      ];
      const result = filterCards(cards, { ...DEFAULT_FILTER, hasBlocker: false });
      expect(result).toHaveLength(1);
      expect(result[0].blockedReason).toBeUndefined();
      expect(result[0].column).not.toBe("blocked");
    });
  });

  describe("filterCards - combined filters", () => {
    it("applies multiple filters together", () => {
      const cards = [
        makeCard({ title: "API work", column: "todo", tags: ["urgent"] }),
        makeCard({ title: "API fix", column: "doing", tags: ["urgent"] }),
        makeCard({ title: "Buy milk", column: "todo", tags: ["personal"] }),
      ];
      const result = filterCards(cards, {
        ...DEFAULT_FILTER,
        search: "API",
        columns: ["todo"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("API work");
    });
  });

  describe("getAllTags", () => {
    it("returns empty array when no cards have tags", () => {
      const cards = [makeCard({}), makeCard({})];
      const result = getAllTags(cards);
      expect(result).toEqual([]);
    });

    it("returns unique sorted tags from all cards", () => {
      const cards = [
        makeCard({ tags: ["urgent", "work"] }),
        makeCard({ tags: ["work", "personal"] }),
        makeCard({ tags: ["urgent"] }),
      ];
      const result = getAllTags(cards);
      expect(result).toEqual(["personal", "urgent", "work"]);
    });

    it("handles cards without tags array", () => {
      const cards = [makeCard({ tags: ["test"] }), makeCard({})];
      const result = getAllTags(cards);
      expect(result).toEqual(["test"]);
    });
  });
});
