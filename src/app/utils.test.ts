import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nowIso, isToday, groupByColumn, isSafeUrl, getSafeUrl } from "./utils";
import { DEFAULT_COLUMNS } from "./constants";
import type { Card } from "./types";

describe("utils", () => {
  describe("nowIso", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns current time in ISO format", () => {
      const mockDate = new Date("2024-06-15T10:30:00.000Z");
      vi.setSystemTime(mockDate);

      const result = nowIso();

      expect(result).toBe("2024-06-15T10:30:00.000Z");
    });

    it("includes milliseconds in output", () => {
      const mockDate = new Date("2024-01-01T00:00:00.123Z");
      vi.setSystemTime(mockDate);

      const result = nowIso();

      expect(result).toMatch(/\.123Z$/);
    });

    it("returns different values as time progresses", () => {
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
      const first = nowIso();

      vi.advanceTimersByTime(1000);
      const second = nowIso();

      expect(first).not.toBe(second);
    });
  });

  describe("isToday", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns true for today's date", () => {
      const now = new Date();
      vi.setSystemTime(now);

      // Create a date that's definitely today in local time
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      expect(isToday(todayStart.toISOString())).toBe(true);
      expect(isToday(todayMid.toISOString())).toBe(true);
      expect(isToday(todayEnd.toISOString())).toBe(true);
    });

    it("returns false for yesterday", () => {
      const now = new Date();
      vi.setSystemTime(now);

      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      expect(isToday(yesterday.toISOString())).toBe(false);
    });

    it("returns false for tomorrow", () => {
      vi.setSystemTime(new Date("2024-06-15T10:30:00.000Z"));

      expect(isToday("2024-06-16T00:00:00.000Z")).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isToday(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isToday("")).toBe(false);
    });

    it("handles different years", () => {
      vi.setSystemTime(new Date("2024-06-15T10:30:00.000Z"));

      expect(isToday("2023-06-15T10:30:00.000Z")).toBe(false);
      expect(isToday("2025-06-15T10:30:00.000Z")).toBe(false);
    });

    it("handles month boundaries", () => {
      const june1 = new Date(2024, 5, 1, 10, 30, 0); // June 1, 2024 local time
      vi.setSystemTime(june1);

      const may31 = new Date(2024, 4, 31, 23, 59, 59);
      const june1Start = new Date(2024, 5, 1, 0, 0, 0);

      expect(isToday(may31.toISOString())).toBe(false);
      expect(isToday(june1Start.toISOString())).toBe(true);
    });

    it("handles year boundaries", () => {
      vi.setSystemTime(new Date("2024-01-01T10:30:00.000Z"));

      expect(isToday("2023-12-31T23:59:59.999Z")).toBe(false);
      expect(isToday("2024-01-01T00:00:00.000Z")).toBe(true);
    });

    it("handles leap year dates", () => {
      vi.setSystemTime(new Date("2024-02-29T10:30:00.000Z"));

      expect(isToday("2024-02-29T00:00:00.000Z")).toBe(true);
      expect(isToday("2024-02-28T23:59:59.999Z")).toBe(false);
    });
  });

  describe("groupByColumn", () => {
    const createCard = (id: string, column: string): Card => ({
      id,
      column,
      title: `Card ${id}`,
      order: 0,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      tags: [],
      checklist: [],
    });

    it("returns empty arrays for all columns when given empty input and columns array", () => {
      const result = groupByColumn([], DEFAULT_COLUMNS);

      expect(result.backlog).toEqual([]);
      expect(result.design).toEqual([]);
      expect(result.todo).toEqual([]);
      expect(result.doing).toEqual([]);
      expect(result.blocked).toEqual([]);
      expect(result.done).toEqual([]);
    });

    it("groups a single card into correct column", () => {
      const cards = [createCard("1", "todo")];

      const result = groupByColumn(cards, DEFAULT_COLUMNS);

      expect(result.todo).toHaveLength(1);
      expect(result.todo[0].id).toBe("1");
      expect(result.backlog).toHaveLength(0);
      expect(result.design).toHaveLength(0);
      expect(result.doing).toHaveLength(0);
      expect(result.blocked).toHaveLength(0);
      expect(result.done).toHaveLength(0);
    });

    it("groups multiple cards into same column", () => {
      const cards = [
        createCard("1", "todo"),
        createCard("2", "todo"),
        createCard("3", "todo"),
      ];

      const result = groupByColumn(cards, DEFAULT_COLUMNS);

      expect(result.todo).toHaveLength(3);
      expect(result.todo.map((c) => c.id)).toEqual(["1", "2", "3"]);
    });

    it("groups cards into different columns", () => {
      const cards = [
        createCard("1", "backlog"),
        createCard("2", "design"),
        createCard("3", "todo"),
        createCard("4", "doing"),
        createCard("5", "blocked"),
        createCard("6", "done"),
      ];

      const result = groupByColumn(cards, DEFAULT_COLUMNS);

      expect(result.backlog).toHaveLength(1);
      expect(result.design).toHaveLength(1);
      expect(result.todo).toHaveLength(1);
      expect(result.doing).toHaveLength(1);
      expect(result.blocked).toHaveLength(1);
      expect(result.done).toHaveLength(1);

      expect(result.backlog[0].id).toBe("1");
      expect(result.design[0].id).toBe("2");
      expect(result.todo[0].id).toBe("3");
      expect(result.doing[0].id).toBe("4");
      expect(result.blocked[0].id).toBe("5");
      expect(result.done[0].id).toBe("6");
    });

    it("handles mixed distribution of cards", () => {
      const cards = [
        createCard("1", "todo"),
        createCard("2", "todo"),
        createCard("3", "doing"),
        createCard("4", "backlog"),
        createCard("5", "todo"),
        createCard("6", "done"),
        createCard("7", "done"),
      ];

      const result = groupByColumn(cards, DEFAULT_COLUMNS);

      expect(result.backlog).toHaveLength(1);
      expect(result.design).toHaveLength(0);
      expect(result.todo).toHaveLength(3);
      expect(result.doing).toHaveLength(1);
      expect(result.blocked).toHaveLength(0);
      expect(result.done).toHaveLength(2);
    });

    it("preserves card order within columns", () => {
      const cards = [
        createCard("first", "todo"),
        createCard("second", "todo"),
        createCard("third", "todo"),
      ];

      const result = groupByColumn(cards, DEFAULT_COLUMNS);

      expect(result.todo.map((c) => c.id)).toEqual(["first", "second", "third"]);
    });

    it("preserves all card properties", () => {
      const fullCard: Card = {
        id: "full-card",
        column: "doing",
        title: "Full Card Title",
        order: 0,
        icon: "🎯",
        notes: "Some notes here",
        link: "https://example.com",
        dueDate: "2024-12-31T00:00:00.000Z",
        tags: ["urgent", "feature"],
        checklist: [{ id: "c1", text: "Item 1", done: true }],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        blockedReason: "Waiting",
        lastOverrideReason: "Emergency",
        lastOverrideAt: "2024-01-03T00:00:00.000Z",
      };

      const result = groupByColumn([fullCard], DEFAULT_COLUMNS);

      expect(result.doing[0]).toEqual(fullCard);
    });

    it("handles large number of cards efficiently", () => {
      const cards: Card[] = [];
      const columnIds = ["backlog", "design", "todo", "doing", "blocked", "done"];

      for (let i = 0; i < 1000; i++) {
        cards.push(createCard(`card-${i}`, columnIds[i % columnIds.length]));
      }

      const start = performance.now();
      const result = groupByColumn(cards, DEFAULT_COLUMNS);
      const duration = performance.now() - start;

      // Should complete in reasonable time (less than 100ms)
      expect(duration).toBeLessThan(100);

      // Verify distribution
      const totalGrouped =
        (result.backlog?.length ?? 0) +
        (result.design?.length ?? 0) +
        (result.todo?.length ?? 0) +
        (result.doing?.length ?? 0) +
        (result.blocked?.length ?? 0) +
        (result.done?.length ?? 0);

      expect(totalGrouped).toBe(1000);
    });

    it("handles cards without columns array passed", () => {
      const cards = [createCard("1", "todo"), createCard("2", "backlog")];

      const result = groupByColumn(cards);

      expect(result.todo).toHaveLength(1);
      expect(result.backlog).toHaveLength(1);
    });
  });

  describe("isSafeUrl", () => {
    it("returns true for http URLs", () => {
      expect(isSafeUrl("http://example.com")).toBe(true);
      expect(isSafeUrl("http://localhost:3000")).toBe(true);
      expect(isSafeUrl("http://example.com/path?query=1")).toBe(true);
    });

    it("returns true for https URLs", () => {
      expect(isSafeUrl("https://example.com")).toBe(true);
      expect(isSafeUrl("https://secure-site.org/page")).toBe(true);
      expect(isSafeUrl("https://github.com/user/repo")).toBe(true);
    });

    it("returns false for javascript: protocol", () => {
      expect(isSafeUrl("javascript:alert('xss')")).toBe(false);
      expect(isSafeUrl("javascript:void(0)")).toBe(false);
      expect(isSafeUrl("JAVASCRIPT:alert(1)")).toBe(false);
    });

    it("returns false for data: protocol", () => {
      expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
      expect(isSafeUrl("data:image/png;base64,abc123")).toBe(false);
    });

    it("returns false for vbscript: protocol", () => {
      expect(isSafeUrl("vbscript:msgbox('xss')")).toBe(false);
    });

    it("returns false for file: protocol", () => {
      expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    });

    it("returns true for relative URLs starting with /", () => {
      expect(isSafeUrl("/page")).toBe(true);
      expect(isSafeUrl("/path/to/resource")).toBe(true);
      expect(isSafeUrl("/api/data?id=1")).toBe(true);
    });

    it("returns false for protocol-relative URLs (//)", () => {
      expect(isSafeUrl("//example.com")).toBe(false);
    });

    it("returns false for empty or invalid input", () => {
      expect(isSafeUrl("")).toBe(false);
      expect(isSafeUrl(null as unknown as string)).toBe(false);
      expect(isSafeUrl(undefined as unknown as string)).toBe(false);
    });

    it("returns false for malformed URLs", () => {
      expect(isSafeUrl("not a url")).toBe(false);
      expect(isSafeUrl("://missing-protocol")).toBe(false);
    });
  });

  describe("getSafeUrl", () => {
    it("returns the URL if it is safe", () => {
      expect(getSafeUrl("https://example.com")).toBe("https://example.com");
      expect(getSafeUrl("http://localhost")).toBe("http://localhost");
      expect(getSafeUrl("/relative/path")).toBe("/relative/path");
    });

    it("returns undefined for unsafe URLs", () => {
      expect(getSafeUrl("javascript:alert(1)")).toBeUndefined();
      expect(getSafeUrl("data:text/html,<script>")).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(getSafeUrl(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(getSafeUrl("")).toBeUndefined();
    });
  });
});
