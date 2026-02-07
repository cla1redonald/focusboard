import { describe, it, expect } from "vitest";
import { SOURCE_CONFIG } from "./captureTypes";
import type { CaptureSource, CaptureQueueItem, ParsedCaptureCard, CaptureStatus } from "./captureTypes";

describe("captureTypes", () => {
  describe("SOURCE_CONFIG", () => {
    const ALL_SOURCES: CaptureSource[] = ["email", "slack", "shortcut", "browser", "whatsapp", "in_app"];

    it("has an entry for every CaptureSource value", () => {
      for (const source of ALL_SOURCES) {
        expect(SOURCE_CONFIG[source]).toBeDefined();
      }
    });

    it("has exactly the same number of entries as CaptureSource values", () => {
      expect(Object.keys(SOURCE_CONFIG)).toHaveLength(ALL_SOURCES.length);
    });

    it.each(ALL_SOURCES)("SOURCE_CONFIG[%s] has required label, borderColor, darkBorderColor, and icon", (source) => {
      const config = SOURCE_CONFIG[source];
      expect(config.label).toBeTruthy();
      expect(typeof config.label).toBe("string");
      expect(config.borderColor).toBeTruthy();
      expect(config.borderColor).toMatch(/^border-l-/);
      expect(config.darkBorderColor).toBeTruthy();
      expect(config.darkBorderColor).toMatch(/^dark:border-l-/);
      expect(config.icon).toBeTruthy();
      expect(typeof config.icon).toBe("string");
    });

    it("has unique labels for all sources", () => {
      const labels = Object.values(SOURCE_CONFIG).map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    it("has unique border colors for all sources", () => {
      const colors = Object.values(SOURCE_CONFIG).map((c) => c.borderColor);
      expect(new Set(colors).size).toBe(colors.length);
    });

    it("Slack source maps to expected display values", () => {
      expect(SOURCE_CONFIG.slack.label).toBe("Slack");
      expect(SOURCE_CONFIG.slack.borderColor).toContain("emerald");
    });

    it("Email source maps to expected display values", () => {
      expect(SOURCE_CONFIG.email.label).toBe("Email");
      expect(SOURCE_CONFIG.email.borderColor).toContain("blue");
    });
  });

  describe("CaptureQueueItem type shape", () => {
    it("accepts a valid CaptureQueueItem object", () => {
      const item: CaptureQueueItem = {
        id: "test-1",
        user_id: "user-1",
        status: "ready",
        confidence: 0.85,
        source: "slack",
        raw_content: "Test content",
        raw_metadata: {},
        parsed_cards: [
          {
            title: "Test card",
            confidence: 0.85,
          },
        ],
        created_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      };
      expect(item.id).toBe("test-1");
      expect(item.parsed_cards).toHaveLength(1);
    });

    it("allows null for confidence and parsed_cards", () => {
      const item: CaptureQueueItem = {
        id: "test-2",
        user_id: "user-2",
        status: "pending",
        confidence: null,
        source: "email",
        raw_content: "Some email",
        raw_metadata: {},
        parsed_cards: null,
        created_at: new Date().toISOString(),
        processed_at: null,
      };
      expect(item.confidence).toBeNull();
      expect(item.parsed_cards).toBeNull();
      expect(item.processed_at).toBeNull();
    });
  });

  describe("ParsedCaptureCard type shape", () => {
    it("accepts a minimal ParsedCaptureCard (title + confidence only)", () => {
      const card: ParsedCaptureCard = {
        title: "A task",
        confidence: 0.9,
      };
      expect(card.title).toBe("A task");
      expect(card.notes).toBeUndefined();
      expect(card.tags).toBeUndefined();
      expect(card.swimlane).toBeUndefined();
      expect(card.suggestedColumn).toBeUndefined();
      expect(card.dueDate).toBeUndefined();
      expect(card.duplicateOf).toBeUndefined();
      expect(card.relatedTo).toBeUndefined();
    });

    it("accepts a fully populated ParsedCaptureCard", () => {
      const card: ParsedCaptureCard = {
        title: "Full card",
        notes: "Some notes",
        tags: ["high", "bug"],
        swimlane: "personal",
        suggestedColumn: "todo",
        dueDate: "2026-03-01",
        confidence: 0.75,
        duplicateOf: "card-123",
        relatedTo: ["card-456", "card-789"],
      };
      expect(card.tags).toHaveLength(2);
      expect(card.swimlane).toBe("personal");
      expect(card.duplicateOf).toBe("card-123");
      expect(card.relatedTo).toHaveLength(2);
    });
  });

  describe("CaptureStatus values", () => {
    it("all expected statuses are valid", () => {
      const statuses: CaptureStatus[] = ["pending", "processing", "ready", "auto_added", "dismissed"];
      expect(statuses).toHaveLength(5);
    });
  });
});
