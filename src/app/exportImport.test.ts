import { describe, it, expect } from "vitest";
import {
  exportToJson,
  exportToCsv,
  validateImportData,
  mergeImportData,
} from "./exportImport";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";
import type { AppState, Card } from "./types";

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  id: `card-${Math.random().toString(36).slice(2)}`,
  column: "todo",
  title: "Test Card",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const makeState = (overrides: Partial<AppState> = {}): AppState => ({
  cards: [],
  columns: DEFAULT_COLUMNS,
  templates: [],
  settings: DEFAULT_SETTINGS,
  ...overrides,
});

describe("exportImport", () => {
  describe("exportToJson", () => {
    it("exports state with version and timestamp", () => {
      const state = makeState({ cards: [makeCard({ title: "My Task" })] });
      const json = exportToJson(state);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(2);
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.data.cards).toHaveLength(1);
      expect(parsed.data.cards[0].title).toBe("My Task");
    });

    it("includes all state properties", () => {
      const state = makeState({
        cards: [makeCard()],
        settings: { ...DEFAULT_SETTINGS, celebrations: false },
      });
      const json = exportToJson(state);
      const parsed = JSON.parse(json);

      expect(parsed.data.columns).toEqual(DEFAULT_COLUMNS);
      expect(parsed.data.settings.celebrations).toBe(false);
      expect(parsed.data.templates).toEqual([]);
    });
  });

  describe("exportToCsv", () => {
    it("exports cards with headers", () => {
      const cards = [
        makeCard({ id: "1", title: "Task 1", column: "todo" }),
        makeCard({ id: "2", title: "Task 2", column: "doing" }),
      ];
      const csv = exportToCsv(cards, DEFAULT_COLUMNS);
      const lines = csv.split("\n");

      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("title");
      expect(lines[0]).toContain("column");
      expect(lines).toHaveLength(3);
    });

    it("escapes special characters in CSV", () => {
      const cards = [
        makeCard({ title: 'Task with "quotes" and, commas' }),
      ];
      const csv = exportToCsv(cards, DEFAULT_COLUMNS);

      expect(csv).toContain('"Task with ""quotes"" and, commas"');
    });

    it("includes column name mapping", () => {
      const cards = [makeCard({ column: "todo" })];
      const csv = exportToCsv(cards, DEFAULT_COLUMNS);

      expect(csv).toContain("To Do");
    });

    it("exports tags joined with semicolons", () => {
      const cards = [makeCard({ tags: ["urgent", "work", "feature"] })];
      const csv = exportToCsv(cards, DEFAULT_COLUMNS);

      expect(csv).toContain("urgent; work; feature");
    });
  });

  describe("validateImportData", () => {
    it("returns error for invalid JSON", () => {
      const result = validateImportData("not valid json {");

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Invalid JSON");
    });

    it("returns error for non-object input", () => {
      const result = validateImportData('"just a string"');

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("must be an object");
    });

    it("validates v2 export format", () => {
      const exportData = {
        version: 2,
        exportedAt: "2024-01-01T00:00:00.000Z",
        data: makeState({ cards: [makeCard()] }),
      };
      const result = validateImportData(JSON.stringify(exportData));

      expect(result.valid).toBe(true);
      expect(result.data?.cards).toHaveLength(1);
    });

    it("validates raw AppState format", () => {
      const state = makeState({ cards: [makeCard()] });
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.data?.cards).toHaveLength(1);
    });

    it("returns error for cards missing required fields", () => {
      const state = {
        cards: [{ id: "1", title: "Missing column" }],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("column"))).toBe(true);
    });

    it("warns about duplicate card IDs", () => {
      const state = {
        cards: [
          makeCard({ id: "dup-id" }),
          makeCard({ id: "dup-id" }),
        ],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
      expect(result.data?.cards).toHaveLength(1);
    });

    it("uses default columns when missing", () => {
      const state = { cards: [], settings: DEFAULT_SETTINGS };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("default columns"))).toBe(true);
      expect(result.data?.columns).toEqual(DEFAULT_COLUMNS);
    });

    it("uses default settings when missing", () => {
      const state = { cards: [], columns: DEFAULT_COLUMNS };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.data?.settings).toEqual(DEFAULT_SETTINGS);
    });

    it("warns about orphaned cards and moves them", () => {
      const state = {
        cards: [makeCard({ column: "non-existent-column" })],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("non-existent columns"))).toBe(true);
      expect(result.data?.cards[0].column).toBe(DEFAULT_COLUMNS[0].id);
    });

    it("validates card optional fields", () => {
      const state = {
        cards: [
          makeCard({
            icon: "🎯",
            notes: "Some notes",
            link: "https://example.com",
            dueDate: "2024-12-31T00:00:00.000Z",
            tags: ["tag1", "tag2"],
            checklist: [{ id: "c1", text: "Item 1", done: true }],
          }),
        ],
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      const card = result.data?.cards[0];
      expect(card?.icon).toBe("🎯");
      expect(card?.tags).toEqual(["tag1", "tag2"]);
      expect(card?.checklist).toHaveLength(1);
    });

    it("provides stats on successful validation", () => {
      const state = makeState({
        cards: [makeCard(), makeCard()],
        templates: [
          { id: "t1", name: "Bug", title: "Bug:", defaultColumn: "todo" },
        ],
      });
      const result = validateImportData(JSON.stringify(state));

      expect(result.valid).toBe(true);
      expect(result.stats?.cardCount).toBe(2);
      expect(result.stats?.columnCount).toBe(DEFAULT_COLUMNS.length);
      expect(result.stats?.templateCount).toBe(1);
    });
  });

  describe("mergeImportData", () => {
    it("adds new cards without duplicates", () => {
      const existing = makeState({
        cards: [makeCard({ id: "existing-1", title: "Existing Card" })],
      });
      const imported = makeState({
        cards: [
          makeCard({ id: "existing-1", title: "Should Skip" }),
          makeCard({ id: "new-1", title: "New Card" }),
        ],
      });

      const merged = mergeImportData(existing, imported);

      expect(merged.cards).toHaveLength(2);
      expect(merged.cards[0].title).toBe("Existing Card");
      expect(merged.cards[1].title).toBe("New Card");
    });

    it("adds new columns with correct order", () => {
      const existing = makeState();
      const imported = makeState({
        columns: [
          { id: "new-col", title: "New Column", icon: "📌", color: "#123456", wipLimit: null, isTerminal: false, order: 0 },
        ],
      });

      const merged = mergeImportData(existing, imported);

      expect(merged.columns.length).toBe(DEFAULT_COLUMNS.length + 1);
      const newCol = merged.columns.find((c) => c.id === "new-col");
      expect(newCol).toBeDefined();
      expect(newCol?.order).toBeGreaterThan(DEFAULT_COLUMNS.length - 1);
    });

    it("adds new templates without duplicates", () => {
      const existing = makeState({
        templates: [{ id: "t1", name: "Bug", title: "Bug:", defaultColumn: "todo" }],
      });
      const imported = makeState({
        templates: [
          { id: "t1", name: "Should Skip", title: "Skip:", defaultColumn: "todo" },
          { id: "t2", name: "Feature", title: "Feature:", defaultColumn: "todo" },
        ],
      });

      const merged = mergeImportData(existing, imported);

      expect(merged.templates).toHaveLength(2);
      expect(merged.templates[0].name).toBe("Bug");
      expect(merged.templates[1].name).toBe("Feature");
    });

    it("keeps existing settings in merge mode", () => {
      const existing = makeState({
        settings: { ...DEFAULT_SETTINGS, celebrations: false },
      });
      const imported = makeState({
        settings: { ...DEFAULT_SETTINGS, celebrations: true },
      });

      const merged = mergeImportData(existing, imported);

      expect(merged.settings.celebrations).toBe(false);
    });
  });
});
