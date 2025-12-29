import { describe, it, expect } from "vitest";
import {
  getUrgencyLevel,
  getDaysUntilDue,
  getUrgencyColor,
  getUrgencyLabel,
  getUrgencyPriorityTag,
  calculateAutoPriority,
  isStaleBacklogCard,
  getStaleBacklogDays,
} from "./urgency";
import type { Card } from "./types";

function createCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "test-card",
    column: "todo",
    title: "Test Card",
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    checklist: [],
    ...overrides,
  };
}

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

describe("urgency", () => {
  describe("getUrgencyLevel", () => {
    it("returns 'none' when card has no due date", () => {
      const card = createCard();
      expect(getUrgencyLevel(card)).toBe("none");
    });

    it("returns 'critical' when card is overdue", () => {
      const card = createCard({ dueDate: daysAgo(1) });
      expect(getUrgencyLevel(card)).toBe("critical");
    });

    it("returns 'high' when due within 3 days", () => {
      const card = createCard({ dueDate: daysFromNow(2) });
      expect(getUrgencyLevel(card)).toBe("high");
    });

    it("returns 'medium' when due within 7 days", () => {
      const card = createCard({ dueDate: daysFromNow(5) });
      expect(getUrgencyLevel(card)).toBe("medium");
    });

    it("returns 'low' when due within 14 days", () => {
      const card = createCard({ dueDate: daysFromNow(10) });
      expect(getUrgencyLevel(card)).toBe("low");
    });

    it("returns 'none' when due date is more than 14 days away", () => {
      const card = createCard({ dueDate: daysFromNow(20) });
      expect(getUrgencyLevel(card)).toBe("none");
    });

    it("returns 'high' when due today", () => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const card = createCard({ dueDate: today.toISOString() });
      expect(getUrgencyLevel(card)).toBe("high");
    });
  });

  describe("getDaysUntilDue", () => {
    it("returns null when card has no due date", () => {
      const card = createCard();
      expect(getDaysUntilDue(card)).toBeNull();
    });

    it("returns positive number for future due dates", () => {
      const card = createCard({ dueDate: daysFromNow(5) });
      const result = getDaysUntilDue(card);
      expect(result).toBeGreaterThanOrEqual(4);
      expect(result).toBeLessThanOrEqual(6);
    });

    it("returns negative number for overdue cards", () => {
      const card = createCard({ dueDate: daysAgo(3) });
      const result = getDaysUntilDue(card);
      expect(result).toBeLessThan(0);
    });
  });

  describe("getUrgencyColor", () => {
    it("returns red for critical urgency", () => {
      expect(getUrgencyColor("critical")).toBe("#DC2626");
    });

    it("returns orange for high urgency", () => {
      expect(getUrgencyColor("high")).toBe("#F97316");
    });

    it("returns yellow for medium urgency", () => {
      expect(getUrgencyColor("medium")).toBe("#EAB308");
    });

    it("returns blue for low urgency", () => {
      expect(getUrgencyColor("low")).toBe("#3B82F6");
    });

    it("returns transparent for none", () => {
      expect(getUrgencyColor("none")).toBe("transparent");
    });
  });

  describe("getUrgencyLabel", () => {
    it("returns 'Overdue' for critical", () => {
      expect(getUrgencyLabel("critical")).toBe("Overdue");
    });

    it("returns 'Due soon' for high", () => {
      expect(getUrgencyLabel("high")).toBe("Due soon");
    });

    it("returns 'This week' for medium", () => {
      expect(getUrgencyLabel("medium")).toBe("This week");
    });

    it("returns 'Upcoming' for low", () => {
      expect(getUrgencyLabel("low")).toBe("Upcoming");
    });

    it("returns empty string for none", () => {
      expect(getUrgencyLabel("none")).toBe("");
    });
  });

  describe("getUrgencyPriorityTag", () => {
    it("returns 'high' for critical urgency", () => {
      expect(getUrgencyPriorityTag("critical")).toBe("high");
    });

    it("returns 'high' for high urgency", () => {
      expect(getUrgencyPriorityTag("high")).toBe("high");
    });

    it("returns 'medium' for medium urgency", () => {
      expect(getUrgencyPriorityTag("medium")).toBe("medium");
    });

    it("returns 'low' for low urgency", () => {
      expect(getUrgencyPriorityTag("low")).toBe("low");
    });

    it("returns null for none", () => {
      expect(getUrgencyPriorityTag("none")).toBeNull();
    });
  });

  describe("calculateAutoPriority", () => {
    it("returns priority tag ID for card with due date and no existing priority", () => {
      const card = createCard({ dueDate: daysFromNow(2), tags: [] });
      expect(calculateAutoPriority(card, [])).toBe("high");
    });

    it("returns null when card already has a priority tag", () => {
      const card = createCard({ dueDate: daysFromNow(2), tags: ["high"] });
      expect(calculateAutoPriority(card, ["high"])).toBeNull();
    });

    it("returns null when card has medium priority tag", () => {
      const card = createCard({ dueDate: daysFromNow(2), tags: ["medium"] });
      expect(calculateAutoPriority(card, ["medium"])).toBeNull();
    });

    it("returns null when card has low priority tag", () => {
      const card = createCard({ dueDate: daysFromNow(2), tags: ["low"] });
      expect(calculateAutoPriority(card, ["low"])).toBeNull();
    });

    it("returns null when card has no due date", () => {
      const card = createCard({ tags: [] });
      expect(calculateAutoPriority(card, [])).toBeNull();
    });

    it("returns null when due date is more than 14 days away", () => {
      const card = createCard({ dueDate: daysFromNow(20), tags: [] });
      expect(calculateAutoPriority(card, [])).toBeNull();
    });

    it("returns 'medium' for cards due within 7 days", () => {
      const card = createCard({ dueDate: daysFromNow(5), tags: [] });
      expect(calculateAutoPriority(card, [])).toBe("medium");
    });

    it("returns 'low' for cards due within 14 days", () => {
      const card = createCard({ dueDate: daysFromNow(10), tags: [] });
      expect(calculateAutoPriority(card, [])).toBe("low");
    });
  });

  describe("isStaleBacklogCard", () => {
    it("returns true for backlog card without due date that is stale", () => {
      const card = createCard({
        column: "backlog",
        updatedAt: daysAgo(10),
      });
      expect(isStaleBacklogCard(card, "backlog", 7)).toBe(true);
    });

    it("returns false for backlog card that was recently updated", () => {
      const card = createCard({
        column: "backlog",
        updatedAt: daysAgo(3),
      });
      expect(isStaleBacklogCard(card, "backlog", 7)).toBe(false);
    });

    it("returns false for backlog card with due date", () => {
      const card = createCard({
        column: "backlog",
        dueDate: daysFromNow(5),
        updatedAt: daysAgo(10),
      });
      expect(isStaleBacklogCard(card, "backlog", 7)).toBe(false);
    });

    it("returns false for non-backlog cards", () => {
      const card = createCard({
        column: "todo",
        updatedAt: daysAgo(10),
      });
      expect(isStaleBacklogCard(card, "todo", 7)).toBe(false);
    });

    it("respects different threshold values", () => {
      const card = createCard({
        column: "backlog",
        updatedAt: daysAgo(5),
      });
      expect(isStaleBacklogCard(card, "backlog", 3)).toBe(true);
      expect(isStaleBacklogCard(card, "backlog", 7)).toBe(false);
    });
  });

  describe("getStaleBacklogDays", () => {
    it("returns number of days since last update", () => {
      const card = createCard({
        updatedAt: daysAgo(5),
      });
      const result = getStaleBacklogDays(card);
      expect(result).toBeGreaterThanOrEqual(4);
      expect(result).toBeLessThanOrEqual(6);
    });

    it("returns 0 for recently updated cards", () => {
      const card = createCard({
        updatedAt: new Date().toISOString(),
      });
      expect(getStaleBacklogDays(card)).toBe(0);
    });
  });
});
