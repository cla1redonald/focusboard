import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadState, saveState } from "./storage";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "./constants";
import type { AppState, Card } from "./types";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("loadState", () => {
    it("returns default state when localStorage is empty", () => {
      const state = loadState();
      expect(state).toEqual({
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      });
    });

    it("returns default state when localStorage has null value", () => {
      const state = loadState();
      expect(state).toEqual({
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      });
    });

    it("loads and parses stored v2 state correctly", () => {
      // v2 state doesn't have tagCategories/tags - migration will add them
      const storedState = {
        cards: [
          {
            id: "card-1",
            column: "todo",
            title: "Test Card",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            tags: ["test"],
            checklist: [],
          },
        ],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: {
          ...DEFAULT_SETTINGS,
          celebrations: false,
        },
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(storedState));

      const state = loadState();
      expect(state.cards).toHaveLength(1);
      expect(state.cards[0].title).toBe("Test Card");
      expect(state.settings.celebrations).toBe(false);
    });

    it("migrates v1 state to v2 format", () => {
      const v1State = {
        cards: [
          {
            id: "card-1",
            column: "todo",
            title: "V1 Card",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            tags: [],
            checklist: [],
          },
        ],
        settings: {
          celebrations: false,
          reducedMotionOverride: true,
          backgroundImage: null,
          columnColors: {
            backlog: "#ff0000",
          },
          columnIcons: {
            backlog: "📦",
          },
          wip: {
            design: 10,
            todo: 8,
            doing: 1,
            blocked: 3,
          },
        },
      };

      localStorage.setItem("focusboard:v1", JSON.stringify(v1State));

      const state = loadState();
      expect(state.cards).toHaveLength(1);
      expect(state.settings.celebrations).toBe(false);
      expect(state.settings.reducedMotionOverride).toBe(true);

      // Check that columns were created from v1 settings
      const backlogCol = state.columns.find((c) => c.id === "backlog");
      expect(backlogCol?.color).toBe("#ff0000");
      expect(backlogCol?.icon).toBe("📦");

      const designCol = state.columns.find((c) => c.id === "design");
      expect(designCol?.wipLimit).toBe(10);
    });

    it("returns default state for invalid JSON", () => {
      localStorage.setItem("focusboard:v3", "invalid json {{{");

      const state = loadState();
      expect(state).toEqual({
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      });
    });

    it("handles missing cards array gracefully", () => {
      const stateWithoutCards = {
        columns: DEFAULT_COLUMNS,
        settings: DEFAULT_SETTINGS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(stateWithoutCards));

      const state = loadState();
      expect(state.cards).toEqual([]);
    });

    it("handles missing columns array gracefully", () => {
      const stateWithoutColumns = {
        cards: [],
        settings: DEFAULT_SETTINGS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(stateWithoutColumns));

      const state = loadState();
      expect(state.columns).toEqual(DEFAULT_COLUMNS);
    });

    it("handles missing settings object gracefully", () => {
      const stateWithoutSettings = {
        cards: [],
        columns: DEFAULT_COLUMNS,
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(stateWithoutSettings));

      const state = loadState();
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("saveState", () => {
    it("saves state to localStorage with correct key", () => {
      const state: AppState = {
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        "focusboard:v4",
        JSON.stringify(state)
      );
    });

    it("serializes cards correctly", () => {
      const card: Card = {
        id: "test-id",
        column: "doing",
        title: "Test Task",
        order: 0,
        icon: "🎯",
        notes: "Some notes",
        link: "https://example.com",
        dueDate: "2024-12-31T00:00:00.000Z",
        tags: ["urgent", "feature"],
        checklist: [{ id: "check-1", text: "Step 1", done: true }],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        blockedReason: "Waiting for approval",
        lastOverrideReason: "Urgent deadline",
        lastOverrideAt: "2024-01-03T00:00:00.000Z",
      };

      const state: AppState = {
        cards: [card],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);

      const savedValue = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedValue);

      expect(parsed.cards[0]).toEqual(card);
    });

    it("serializes custom settings correctly", () => {
      const state: AppState = {
        cards: [],
        columns: DEFAULT_COLUMNS,
        templates: [],
        settings: {
          ...DEFAULT_SETTINGS,
          celebrations: false,
          reducedMotionOverride: true,
          backgroundImage: "data:image/png;base64,abc123",
        },
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);

      const savedValue = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedValue);

      expect(parsed.settings.celebrations).toBe(false);
      expect(parsed.settings.reducedMotionOverride).toBe(true);
      expect(parsed.settings.backgroundImage).toBe("data:image/png;base64,abc123");
    });

    it("serializes columns with custom settings", () => {
      const customColumns = DEFAULT_COLUMNS.map((col, idx) =>
        idx === 0 ? { ...col, color: "#123456", wipLimit: 20 } : col
      );

      const state: AppState = {
        cards: [],
        columns: customColumns,
        templates: [],
        settings: DEFAULT_SETTINGS,
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      saveState(state);

      const savedValue = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedValue);

      expect(parsed.columns[0].color).toBe("#123456");
      expect(parsed.columns[0].wipLimit).toBe(20);
    });
  });

  describe("round-trip persistence", () => {
    it("maintains data integrity through save and load cycle", () => {
      const originalState: AppState = {
        cards: [
          {
            id: "card-1",
            column: "todo",
            title: "First Task",
            order: 0,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            tags: ["important"],
            checklist: [{ id: "c1", text: "Do thing", done: false }],
          },
          {
            id: "card-2",
            column: "doing",
            title: "Second Task",
            order: 0,
            icon: "🔥",
            createdAt: "2024-01-02T00:00:00.000Z",
            updatedAt: "2024-01-02T00:00:00.000Z",
            tags: [],
            checklist: [],
          },
        ],
        columns: DEFAULT_COLUMNS.map((col) =>
          col.id === "backlog" ? { ...col, color: "#123456" } : col
        ),
        templates: [],
        settings: {
          celebrations: false,
          reducedMotionOverride: true,
          backgroundImage: null,
          showAgingIndicators: true,
          staleCardThreshold: 7,
          autoPriorityFromDueDate: false,
          staleBacklogThreshold: 7,
        },
        tagCategories: DEFAULT_TAG_CATEGORIES,
        tags: DEFAULT_TAGS,
      };

      // Save
      saveState(originalState);

      // Load
      const loadedState = loadState();

      expect(loadedState.cards).toHaveLength(2);
      expect(loadedState.cards[0].title).toBe("First Task");
      expect(loadedState.cards[1].icon).toBe("🔥");
      expect(loadedState.settings.celebrations).toBe(false);
      expect(loadedState.columns.find((c) => c.id === "backlog")?.color).toBe("#123456");
    });
  });
});
