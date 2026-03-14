import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAppState } from "./state";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";
import type { Card, Settings } from "./types";

// Mock nanoid to return predictable IDs
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-id-" + Math.random().toString(36).substring(7)),
}));

describe("state reducer", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("useAppState hook", () => {
    it("initializes with default state when localStorage is empty", () => {
      const { result } = renderHook(() => useAppState());

      expect(result.current.state.cards).toEqual([]);
      expect(result.current.state.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.current.state.columns).toEqual(DEFAULT_COLUMNS);
    });

    it("loads persisted state from localStorage", () => {
      const persistedState = {
        cards: [
          {
            id: "existing-card",
            column: "todo",
            title: "Persisted Card",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            tags: [],
            checklist: [],
          },
        ],
        columns: DEFAULT_COLUMNS,
        settings: {
          ...DEFAULT_SETTINGS,
          celebrations: false,
        },
      };

      localStorage.setItem("focusboard:v2", JSON.stringify(persistedState));

      const { result } = renderHook(() => useAppState());

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("Persisted Card");
      expect(result.current.state.settings.celebrations).toBe(false);
    });
  });

  describe("ADD_CARD action", () => {
    it("adds a new card to the beginning of the cards array", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "New Task",
        });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("New Task");
      expect(result.current.state.cards[0].column).toBe("todo");
    });

    it("trims whitespace from card title", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "backlog",
          title: "  Whitespace Title  ",
        });
      });

      expect(result.current.state.cards[0].title).toBe("Whitespace Title");
    });

    it("creates card with correct initial properties", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "design",
          title: "Design Task",
        });
      });

      const card = result.current.state.cards[0];
      expect(card.id).toBeDefined();
      expect(card.column).toBe("design");
      expect(card.title).toBe("Design Task");
      expect(card.createdAt).toBeDefined();
      expect(card.updatedAt).toBeDefined();
      expect(card.tags).toEqual([]);
      expect(card.checklist).toEqual([]);
    });

    it("adds new cards to the beginning (newest first)", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "First Card",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Second Card",
        });
      });

      expect(result.current.state.cards).toHaveLength(2);
      expect(result.current.state.cards[0].title).toBe("Second Card");
      expect(result.current.state.cards[1].title).toBe("First Card");
    });

    it("can add cards to different columns", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "backlog", title: "Backlog Card" });
        result.current.dispatch({ type: "ADD_CARD", column: "design", title: "Design Card" });
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Todo Card" });
        result.current.dispatch({ type: "ADD_CARD", column: "doing", title: "Doing Card" });
        result.current.dispatch({ type: "ADD_CARD", column: "blocked", title: "Blocked Card" });
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Done Card" });
      });

      expect(result.current.state.cards).toHaveLength(6);
      expect(result.current.state.cards.map((c) => c.column)).toContain("backlog");
      expect(result.current.state.cards.map((c) => c.column)).toContain("design");
      expect(result.current.state.cards.map((c) => c.column)).toContain("todo");
      expect(result.current.state.cards.map((c) => c.column)).toContain("doing");
      expect(result.current.state.cards.map((c) => c.column)).toContain("blocked");
      expect(result.current.state.cards.map((c) => c.column)).toContain("done");
    });
  });

  describe("UPDATE_CARD action", () => {
    it("updates an existing card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Original Title",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            title: "Updated Title",
            notes: "Some notes",
          },
        });
      });

      expect(result.current.state.cards[0].id).toBe(cardId);
      expect(result.current.state.cards[0].title).toBe("Updated Title");
      expect(result.current.state.cards[0].notes).toBe("Some notes");
    });

    it("updates the updatedAt timestamp", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Test Card",
        });
      });

      const originalUpdatedAt = result.current.state.cards[0].updatedAt;

      // Small delay to ensure timestamp differs
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            title: "New Title",
          },
        });
      });

      expect(result.current.state.cards[0].updatedAt).not.toBe(originalUpdatedAt);
      vi.useRealTimers();
    });

    it("updates card checklist", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card with Checklist",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            checklist: [
              { id: "item-1", text: "First item", done: false },
              { id: "item-2", text: "Second item", done: true },
            ],
          },
        });
      });

      expect(result.current.state.cards[0].checklist).toHaveLength(2);
      expect(result.current.state.cards[0].checklist![1].done).toBe(true);
    });

    it("updates card with all optional fields", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Full Card",
        });
      });

      const fullUpdate: Card = {
        ...result.current.state.cards[0],
        icon: "🎯",
        notes: "Detailed notes",
        link: "https://example.com",
        dueDate: "2024-12-31T00:00:00.000Z",
        tags: ["urgent", "feature"],
        blockedReason: "Waiting for API",
        lastOverrideReason: "Emergency",
        lastOverrideAt: "2024-01-15T00:00:00.000Z",
      };

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: fullUpdate,
        });
      });

      const card = result.current.state.cards[0];
      expect(card.icon).toBe("🎯");
      expect(card.notes).toBe("Detailed notes");
      expect(card.link).toBe("https://example.com");
      expect(card.dueDate).toBe("2024-12-31T00:00:00.000Z");
      expect(card.tags).toEqual(["urgent", "feature"]);
      expect(card.blockedReason).toBe("Waiting for API");
      expect(card.lastOverrideReason).toBe("Emergency");
    });

    it("does not affect other cards when updating one", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 3" });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[1],
            title: "Updated Card 2",
          },
        });
      });

      expect(result.current.state.cards[0].title).toBe("Card 3");
      expect(result.current.state.cards[1].title).toBe("Updated Card 2");
      expect(result.current.state.cards[2].title).toBe("Card 1");
    });
  });

  describe("DELETE_CARD action", () => {
    it("removes a card by id", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card to Delete",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "DELETE_CARD",
          id: cardId,
        });
      });

      expect(result.current.state.cards).toHaveLength(0);
    });

    it("does not affect other cards when deleting one", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Keep 1" });
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Delete Me" });
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Keep 2" });
      });

      const deleteId = result.current.state.cards[1].id;

      act(() => {
        result.current.dispatch({
          type: "DELETE_CARD",
          id: deleteId,
        });
      });

      expect(result.current.state.cards).toHaveLength(2);
      expect(result.current.state.cards.map((c) => c.title)).toContain("Keep 1");
      expect(result.current.state.cards.map((c) => c.title)).toContain("Keep 2");
      expect(result.current.state.cards.map((c) => c.title)).not.toContain("Delete Me");
    });

    it("handles deleting non-existent card gracefully", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Existing Card",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "DELETE_CARD",
          id: "non-existent-id",
        });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("Existing Card");
    });
  });

  describe("MOVE_CARD action", () => {
    it("moves a card to a different column", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Moveable Card",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: cardId,
          to: "doing",
        });
      });

      expect(result.current.state.cards[0].column).toBe("doing");
    });

    it("updates the updatedAt timestamp when moving", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Test Card",
        });
      });

      const originalUpdatedAt = result.current.state.cards[0].updatedAt;

      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "doing",
        });
      });

      expect(result.current.state.cards[0].updatedAt).not.toBe(originalUpdatedAt);
      vi.useRealTimers();
    });

    it("applies patch data when moving card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card to Block",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: cardId,
          to: "blocked",
          patch: {
            blockedReason: "Waiting for feedback",
          },
        });
      });

      expect(result.current.state.cards[0].column).toBe("blocked");
      expect(result.current.state.cards[0].blockedReason).toBe("Waiting for feedback");
    });

    it("applies override reason when moving with WIP override", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Override Card",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "design",
          patch: {
            lastOverrideReason: "Urgent priority",
            lastOverrideAt: "2024-01-15T12:00:00.000Z",
          },
        });
      });

      expect(result.current.state.cards[0].column).toBe("design");
      expect(result.current.state.cards[0].lastOverrideReason).toBe("Urgent priority");
      expect(result.current.state.cards[0].lastOverrideAt).toBe("2024-01-15T12:00:00.000Z");
    });

    it("handles moving non-existent card gracefully", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Existing Card",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: "non-existent-id",
          to: "doing",
        });
      });

      // Should not throw and existing cards should remain unchanged
      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].column).toBe("todo");
    });
  });

  describe("SET_SETTINGS action", () => {
    it("updates all settings at once", () => {
      const { result } = renderHook(() => useAppState());

      const newSettings: Settings = {
        celebrations: false,
        reducedMotionOverride: true,
        backgroundImage: "data:image/png;base64,test",
        showAgingIndicators: false,
        staleCardThreshold: 14,
        autoPriorityFromDueDate: true,
        staleBacklogThreshold: 7,
        collapsedSwimlanes: [],
        theme: "dark",
        autoArchive: false,
      };

      act(() => {
        result.current.dispatch({
          type: "SET_SETTINGS",
          settings: newSettings,
        });
      });

      expect(result.current.state.settings).toEqual(newSettings);
    });

    it("does not affect cards when updating settings", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Existing Card",
        });
      });

      const cardsBefore = [...result.current.state.cards];

      act(() => {
        result.current.dispatch({
          type: "SET_SETTINGS",
          settings: {
            ...DEFAULT_SETTINGS,
            celebrations: false,
          },
        });
      });

      expect(result.current.state.cards).toEqual(cardsBefore);
    });
  });

  describe("ADD_COLUMN action", () => {
    it("adds a new column", () => {
      const { result } = renderHook(() => useAppState());

      const initialColumnCount = result.current.state.columns.length;

      act(() => {
        result.current.dispatch({
          type: "ADD_COLUMN",
          column: {
            title: "Review",
            icon: "👁️",
            color: "#aabbcc",
            wipLimit: 3,
            isTerminal: false,
          },
        });
      });

      expect(result.current.state.columns).toHaveLength(initialColumnCount + 1);
      const newColumn = result.current.state.columns[result.current.state.columns.length - 1];
      expect(newColumn.title).toBe("Review");
      expect(newColumn.icon).toBe("👁️");
      expect(newColumn.wipLimit).toBe(3);
    });

    it("assigns correct order to new column", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_COLUMN",
          column: {
            title: "New Column",
            icon: "📌",
            color: "#123456",
            wipLimit: null,
            isTerminal: false,
          },
        });
      });

      const newColumn = result.current.state.columns[result.current.state.columns.length - 1];
      expect(newColumn.order).toBe(DEFAULT_COLUMNS.length);
    });
  });

  describe("UPDATE_COLUMN action", () => {
    it("updates a column", () => {
      const { result } = renderHook(() => useAppState());

      const columnToUpdate = result.current.state.columns[0];

      act(() => {
        result.current.dispatch({
          type: "UPDATE_COLUMN",
          column: {
            ...columnToUpdate,
            title: "Updated Title",
            wipLimit: 10,
          },
        });
      });

      const updatedColumn = result.current.state.columns.find((c) => c.id === columnToUpdate.id);
      expect(updatedColumn?.title).toBe("Updated Title");
      expect(updatedColumn?.wipLimit).toBe(10);
    });
  });

  describe("DELETE_COLUMN action", () => {
    it("deletes a column and removes its cards", () => {
      const { result } = renderHook(() => useAppState());

      // Add a card to the column we'll delete
      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "backlog",
          title: "Card in Backlog",
        });
      });

      const initialColumnCount = result.current.state.columns.length;

      act(() => {
        result.current.dispatch({
          type: "DELETE_COLUMN",
          id: "backlog",
        });
      });

      expect(result.current.state.columns).toHaveLength(initialColumnCount - 1);
      expect(result.current.state.columns.find((c) => c.id === "backlog")).toBeUndefined();
      expect(result.current.state.cards).toHaveLength(0);
    });

    it("migrates cards to another column when specified", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "backlog",
          title: "Card to Migrate",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "DELETE_COLUMN",
          id: "backlog",
          migrateCardsTo: "todo",
        });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].column).toBe("todo");
    });

    it("reorders remaining columns after deletion", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "DELETE_COLUMN",
          id: "design",
        });
      });

      const orders = result.current.state.columns.map((c) => c.order);
      const expectedOrders = Array.from({ length: DEFAULT_COLUMNS.length - 1 }, (_, i) => i);
      expect(orders).toEqual(expectedOrders);
    });
  });

  describe("REORDER_COLUMNS action", () => {
    it("reorders columns", () => {
      const { result } = renderHook(() => useAppState());

      const reordered = [...result.current.state.columns].reverse();

      act(() => {
        result.current.dispatch({
          type: "REORDER_COLUMNS",
          columns: reordered,
        });
      });

      expect(result.current.state.columns[0].id).toBe("wontdo");
      expect(result.current.state.columns[0].order).toBe(0);
      const lastIdx = result.current.state.columns.length - 1;
      expect(result.current.state.columns[lastIdx].id).toBe("backlog");
      expect(result.current.state.columns[lastIdx].order).toBe(lastIdx);
    });
  });

  describe("state persistence", () => {
    it("saves state to localStorage on every state change", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "New Card",
        });
      });

      act(() => {
        vi.runAllTimers();
      });

      // Check that localStorage.setItem was called
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "focusboard:v4",
        expect.any(String)
      );
      vi.useRealTimers();
    });
  });

  describe("UNDO action", () => {
    it("restores previous state after adding a card", () => {
      const { result } = renderHook(() => useAppState());

      expect(result.current.state.cards).toHaveLength(0);

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card to Undo",
        });
      });

      expect(result.current.state.cards).toHaveLength(1);

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);
    });

    it("restores previous state after deleting a card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card to Delete",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "DELETE_CARD",
          id: cardId,
        });
      });

      expect(result.current.state.cards).toHaveLength(0);

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("Card to Delete");
    });

    it("restores previous state after moving a card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Moveable Card",
        });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: cardId,
          to: "doing",
        });
      });

      expect(result.current.state.cards[0].column).toBe("doing");

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards[0].column).toBe("todo");
    });

    it("does nothing when there is no history", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);
    });

    it("can undo multiple actions in sequence", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 3" });
      });

      expect(result.current.state.cards).toHaveLength(3);

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });
      expect(result.current.state.cards).toHaveLength(2);

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });
      expect(result.current.state.cards).toHaveLength(1);

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });
      expect(result.current.state.cards).toHaveLength(0);
    });
  });

  describe("REDO action", () => {
    it("restores undone action", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "Card to Redo",
        });
      });

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);

      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("Card to Redo");
    });

    it("does nothing when there is no future", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);
    });

    it("can redo multiple undone actions", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 3" });
      });

      act(() => {
        result.current.dispatch({ type: "UNDO" });
        result.current.dispatch({ type: "UNDO" });
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);

      act(() => {
        result.current.dispatch({ type: "REDO" });
      });
      expect(result.current.state.cards).toHaveLength(1);

      act(() => {
        result.current.dispatch({ type: "REDO" });
      });
      expect(result.current.state.cards).toHaveLength(2);

      act(() => {
        result.current.dispatch({ type: "REDO" });
      });
      expect(result.current.state.cards).toHaveLength(3);
    });

    it("clears redo history when a new action is performed after undo", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Original Card" });
      });

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "design", title: "New Card" });
      });

      // Redo should do nothing since we performed a new action
      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      expect(result.current.state.cards).toHaveLength(1);
      expect(result.current.state.cards[0].title).toBe("New Card");
    });
  });

  describe("canUndo and canRedo flags", () => {
    it("canUndo is false when there is no history", () => {
      const { result } = renderHook(() => useAppState());

      expect(result.current.canUndo).toBe(false);
    });

    it("canUndo is true after an action", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "New Card",
        });
      });

      expect(result.current.canUndo).toBe(true);
    });

    it("canRedo is false when there is no future", () => {
      const { result } = renderHook(() => useAppState());

      expect(result.current.canRedo).toBe(false);
    });

    it("canRedo is true after undo", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "New Card",
        });
      });

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.canRedo).toBe(true);
    });

    it("canRedo becomes false after new action", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.canRedo).toBe(true);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      expect(result.current.canRedo).toBe(false);
    });
  });

  describe("ADD_RELATION action", () => {
    it("adds a relation between two cards", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      const card1Id = result.current.state.cards[1].id;
      const card2Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: card2Id,
          relationType: "blocks",
        });
      });

      const card1 = result.current.state.cards.find((c) => c.id === card1Id);
      const card2 = result.current.state.cards.find((c) => c.id === card2Id);

      expect(card1?.relations).toHaveLength(1);
      expect(card1?.relations?.[0].type).toBe("blocks");
      expect(card1?.relations?.[0].targetCardId).toBe(card2Id);

      expect(card2?.relations).toHaveLength(1);
      expect(card2?.relations?.[0].type).toBe("blocked-by");
      expect(card2?.relations?.[0].targetCardId).toBe(card1Id);
    });

    it("creates reciprocal parent-child relations", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Parent" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Child" });
      });

      const parentId = result.current.state.cards[1].id;
      const childId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: parentId,
          targetCardId: childId,
          relationType: "parent",
        });
      });

      const parent = result.current.state.cards.find((c) => c.id === parentId);
      const child = result.current.state.cards.find((c) => c.id === childId);

      expect(parent?.relations?.[0].type).toBe("parent");
      expect(child?.relations?.[0].type).toBe("child");
    });

    it("creates symmetric related relations", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card A" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card B" });
      });

      const cardAId = result.current.state.cards[1].id;
      const cardBId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: cardAId,
          targetCardId: cardBId,
          relationType: "related",
        });
      });

      const cardA = result.current.state.cards.find((c) => c.id === cardAId);
      const cardB = result.current.state.cards.find((c) => c.id === cardBId);

      expect(cardA?.relations?.[0].type).toBe("related");
      expect(cardB?.relations?.[0].type).toBe("related");
    });

    it("does not allow relating a card to itself", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Lonely Card" });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: cardId,
          targetCardId: cardId,
          relationType: "blocks",
        });
      });

      const card = result.current.state.cards[0];
      expect(card.relations).toBeUndefined();
    });

    it("does not create duplicate relations", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      const card1Id = result.current.state.cards[1].id;
      const card2Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: card2Id,
          relationType: "blocks",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: card2Id,
          relationType: "blocks",
        });
      });

      const card1 = result.current.state.cards.find((c) => c.id === card1Id);
      expect(card1?.relations).toHaveLength(1);
    });

    it("ignores relations to non-existent cards", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });

      const card1Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: "non-existent-id",
          relationType: "blocks",
        });
      });

      const card1 = result.current.state.cards[0];
      expect(card1.relations).toBeUndefined();
    });
  });

  describe("REMOVE_RELATION action", () => {
    it("removes a relation and its reciprocal", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      const card1Id = result.current.state.cards[1].id;
      const card2Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: card2Id,
          relationType: "blocks",
        });
      });

      const relationId = result.current.state.cards.find((c) => c.id === card1Id)?.relations?.[0].id;

      act(() => {
        result.current.dispatch({
          type: "REMOVE_RELATION",
          cardId: card1Id,
          relationId: relationId!,
        });
      });

      const card1 = result.current.state.cards.find((c) => c.id === card1Id);
      const card2 = result.current.state.cards.find((c) => c.id === card2Id);

      expect(card1?.relations).toHaveLength(0);
      expect(card2?.relations).toHaveLength(0);
    });

    it("handles removing non-existent relation gracefully", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });

      const card1Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "REMOVE_RELATION",
          cardId: card1Id,
          relationId: "non-existent-relation",
        });
      });

      // Should not throw, card should be unchanged
      expect(result.current.state.cards).toHaveLength(1);
    });
  });

  describe("DELETE_CARD cleans up relations", () => {
    it("removes relations pointing to deleted card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      const card1Id = result.current.state.cards[1].id;
      const card2Id = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_RELATION",
          cardId: card1Id,
          targetCardId: card2Id,
          relationType: "blocks",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "DELETE_CARD",
          id: card2Id,
        });
      });

      const card1 = result.current.state.cards[0];
      expect(card1.relations).toHaveLength(0);
    });
  });

  describe("ADD_TAG action", () => {
    it("adds a new tag", () => {
      const { result } = renderHook(() => useAppState());

      const initialTagCount = result.current.state.tags.length;

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: {
            name: "Custom Tag",
            color: "#FF5733",
            categoryId: "priority",
          },
        });
      });

      expect(result.current.state.tags).toHaveLength(initialTagCount + 1);
      const newTag = result.current.state.tags[result.current.state.tags.length - 1];
      expect(newTag.name).toBe("Custom Tag");
      expect(newTag.color).toBe("#FF5733");
      expect(newTag.categoryId).toBe("priority");
      expect(newTag.id).toBeDefined();
    });

    it("generates unique id for new tag", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Tag 1", color: "#111111", categoryId: "type" },
        });
      });

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Tag 2", color: "#222222", categoryId: "type" },
        });
      });

      const tags = result.current.state.tags.slice(-2);
      expect(tags[0].id).not.toBe(tags[1].id);
    });
  });

  describe("UPDATE_TAG action", () => {
    it("updates an existing tag", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Original", color: "#000000", categoryId: "type" },
        });
      });

      const addedTag = result.current.state.tags[result.current.state.tags.length - 1];

      act(() => {
        result.current.dispatch({
          type: "UPDATE_TAG",
          tag: {
            ...addedTag,
            name: "Updated Name",
            color: "#FFFFFF",
          },
        });
      });

      const updatedTag = result.current.state.tags.find((t) => t.id === addedTag.id);
      expect(updatedTag?.name).toBe("Updated Name");
      expect(updatedTag?.color).toBe("#FFFFFF");
    });

    it("does not affect other tags", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Tag A", color: "#AAAAAA", categoryId: "type" },
        });
      });
      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Tag B", color: "#BBBBBB", categoryId: "type" },
        });
      });

      const tagA = result.current.state.tags[result.current.state.tags.length - 2];
      const tagB = result.current.state.tags[result.current.state.tags.length - 1];

      act(() => {
        result.current.dispatch({
          type: "UPDATE_TAG",
          tag: { ...tagA, name: "Updated A" },
        });
      });

      const unchangedB = result.current.state.tags.find((t) => t.id === tagB.id);
      expect(unchangedB?.name).toBe("Tag B");
    });
  });

  describe("DELETE_TAG action", () => {
    it("removes a tag", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "To Delete", color: "#FF0000", categoryId: "effort" },
        });
      });

      const tagId = result.current.state.tags[result.current.state.tags.length - 1].id;
      const countBefore = result.current.state.tags.length;

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG",
          id: tagId,
        });
      });

      expect(result.current.state.tags).toHaveLength(countBefore - 1);
      expect(result.current.state.tags.find((t) => t.id === tagId)).toBeUndefined();
    });

    it("removes tag from all cards that have it", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Shared Tag", color: "#123456", categoryId: "type" },
        });
      });

      const tagId = result.current.state.tags[result.current.state.tags.length - 1].id;

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 1" });
      });
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Card 2" });
      });

      // Add tag to both cards
      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: { ...result.current.state.cards[0], tags: [tagId] },
        });
      });
      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: { ...result.current.state.cards[1], tags: [tagId] },
        });
      });

      expect(result.current.state.cards[0].tags).toContain(tagId);
      expect(result.current.state.cards[1].tags).toContain(tagId);

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG",
          id: tagId,
        });
      });

      expect(result.current.state.cards[0].tags).not.toContain(tagId);
      expect(result.current.state.cards[1].tags).not.toContain(tagId);
    });

    it("handles deleting non-existent tag gracefully", () => {
      const { result } = renderHook(() => useAppState());

      const countBefore = result.current.state.tags.length;

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG",
          id: "non-existent-tag-id",
        });
      });

      expect(result.current.state.tags).toHaveLength(countBefore);
    });
  });

  describe("ADD_TAG_CATEGORY action", () => {
    it("adds a new tag category", () => {
      const { result } = renderHook(() => useAppState());

      const initialCount = result.current.state.tagCategories.length;

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "Custom Category" },
        });
      });

      expect(result.current.state.tagCategories).toHaveLength(initialCount + 1);
      const newCategory = result.current.state.tagCategories[result.current.state.tagCategories.length - 1];
      expect(newCategory.name).toBe("Custom Category");
      expect(newCategory.id).toBeDefined();
      expect(newCategory.order).toBe(initialCount);
    });

    it("assigns correct order to new category", () => {
      const { result } = renderHook(() => useAppState());

      const initialOrder = result.current.state.tagCategories.length;

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "New Category" },
        });
      });

      const newCategory = result.current.state.tagCategories[result.current.state.tagCategories.length - 1];
      expect(newCategory.order).toBe(initialOrder);
    });
  });

  describe("UPDATE_TAG_CATEGORY action", () => {
    it("updates an existing category", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "Original Name" },
        });
      });

      const category = result.current.state.tagCategories[result.current.state.tagCategories.length - 1];

      act(() => {
        result.current.dispatch({
          type: "UPDATE_TAG_CATEGORY",
          category: { ...category, name: "Updated Name" },
        });
      });

      const updated = result.current.state.tagCategories.find((c) => c.id === category.id);
      expect(updated?.name).toBe("Updated Name");
    });
  });

  describe("DELETE_TAG_CATEGORY action", () => {
    it("removes a category and all its tags", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "To Delete" },
        });
      });

      const categoryId = result.current.state.tagCategories[result.current.state.tagCategories.length - 1].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Tag in category", color: "#FF0000", categoryId },
        });
      });

      const tagId = result.current.state.tags.find((t) => t.categoryId === categoryId)?.id;
      expect(tagId).toBeDefined();

      const categoryCountBefore = result.current.state.tagCategories.length;

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG_CATEGORY",
          id: categoryId,
        });
      });

      expect(result.current.state.tagCategories).toHaveLength(categoryCountBefore - 1);
      expect(result.current.state.tagCategories.find((c) => c.id === categoryId)).toBeUndefined();
      expect(result.current.state.tags.find((t) => t.categoryId === categoryId)).toBeUndefined();
    });

    it("removes category tags from cards", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "Temp Category" },
        });
      });

      const categoryId = result.current.state.tagCategories[result.current.state.tagCategories.length - 1].id;

      act(() => {
        result.current.dispatch({
          type: "ADD_TAG",
          tag: { name: "Temp Tag", color: "#999999", categoryId },
        });
      });

      const tagId = result.current.state.tags.find((t) => t.categoryId === categoryId)!.id;

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Test Card" });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: { ...result.current.state.cards[0], tags: [tagId] },
        });
      });

      expect(result.current.state.cards[0].tags).toContain(tagId);

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG_CATEGORY",
          id: categoryId,
        });
      });

      expect(result.current.state.cards[0].tags).not.toContain(tagId);
    });

    it("reorders remaining categories after deletion", () => {
      const { result } = renderHook(() => useAppState());

      // Add two new categories
      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "First" },
        });
      });
      act(() => {
        result.current.dispatch({
          type: "ADD_TAG_CATEGORY",
          category: { name: "Second" },
        });
      });

      const firstCategoryId = result.current.state.tagCategories[result.current.state.tagCategories.length - 2].id;

      act(() => {
        result.current.dispatch({
          type: "DELETE_TAG_CATEGORY",
          id: firstCategoryId,
        });
      });

      // Verify order is consecutive
      const orders = result.current.state.tagCategories.map((c) => c.order);
      const sortedOrders = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sortedOrders);
      expect(orders[0]).toBe(0);
    });
  });

  describe("REORDER_TAG_CATEGORIES action", () => {
    it("reorders categories", () => {
      const { result } = renderHook(() => useAppState());

      const reordered = [...result.current.state.tagCategories].reverse();

      act(() => {
        result.current.dispatch({
          type: "REORDER_TAG_CATEGORIES",
          categories: reordered,
        });
      });

      const lastIndex = result.current.state.tagCategories.length - 1;
      expect(result.current.state.tagCategories[0].name).toBe(reordered[0].name);
      expect(result.current.state.tagCategories[0].order).toBe(0);
      expect(result.current.state.tagCategories[lastIndex].order).toBe(lastIndex);
    });
  });

  describe("ARCHIVE_CARD action", () => {
    it("sets archivedAt on the card", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Done Card" });
      });

      const cardId = result.current.state.cards[0].id;

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();
      expect(typeof result.current.state.cards[0].archivedAt).toBe("string");
    });

    it("preserves existing card fields", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Task to Archive" });
      });

      const card = result.current.state.cards[0];
      const originalColumn = card.column;
      const originalTitle = card.title;
      const cardId = card.id;

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      expect(result.current.state.cards[0].column).toBe(originalColumn);
      expect(result.current.state.cards[0].title).toBe(originalTitle);
    });

    it("updates updatedAt timestamp", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Card" });
      });

      const originalUpdatedAt = result.current.state.cards[0].updatedAt;

      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      expect(result.current.state.cards[0].updatedAt).not.toBe(originalUpdatedAt);
      vi.useRealTimers();
    });

    it("is undoable", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Undoable" });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();

      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });
  });

  describe("UNARCHIVE_CARD action", () => {
    it("clears archivedAt and moves card to target column", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Archived Card" });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();

      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: result.current.state.cards[0].id,
          toColumn: "todo",
        });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
      expect(result.current.state.cards[0].column).toBe("todo");
    });

    it("clears completedAt when restoring to non-terminal column", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Task" });
      });

      // Move to done (terminal)
      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "done",
        });
      });

      expect(result.current.state.cards[0].completedAt).toBeDefined();

      // Archive it
      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      // Restore to non-terminal column
      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: result.current.state.cards[0].id,
          toColumn: "todo",
        });
      });

      expect(result.current.state.cards[0].completedAt).toBeUndefined();
    });

    it("places card at order 0 (top of column)", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Card to Restore" });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: result.current.state.cards[0].id,
          toColumn: "todo",
        });
      });

      expect(result.current.state.cards[0].order).toBe(0);
    });

    it("adds columnHistory entry with from: null", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Card" });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: result.current.state.cards[0].id,
          toColumn: "backlog",
        });
      });

      const history = result.current.state.cards[0].columnHistory;
      const lastEntry = history?.[history.length - 1];
      expect(lastEntry?.from).toBeNull();
      expect(lastEntry?.to).toBe("backlog");
    });

    it("returns unchanged state for invalid target column", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Card" });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: result.current.state.cards[0].id,
          toColumn: "non-existent-column",
        });
      });

      // State should not have changed (no new history entry created)
      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });
  });

  describe("AUTO_ARCHIVE_CARDS action", () => {
    it("archives cards completed in previous months", () => {
      const { result } = renderHook(() => useAppState());

      // Create a card that is "completed" last month
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Old Done Card" });
      });

      // Move to done and set completedAt to last month
      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "done",
        });
      });

      // Manually set completedAt to last month
      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            completedAt: lastMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });

    it("does not archive cards completed this month", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Recent Card" });
      });

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "done",
        });
      });

      // completedAt is now (this month)

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("skips already archived cards", () => {
      const { result } = renderHook(() => useAppState());

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Already Archived" });
      });

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "done",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            completedAt: lastMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: result.current.state.cards[0].id });
      });

      const firstArchivedAt = result.current.state.cards[0].archivedAt;

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // archivedAt should not have changed
      expect(result.current.state.cards[0].archivedAt).toBe(firstArchivedAt);
    });

    it("respects autoArchive setting when disabled", () => {
      const { result } = renderHook(() => useAppState());

      // Disable auto-archive
      act(() => {
        result.current.dispatch({
          type: "SET_SETTINGS",
          settings: { ...result.current.state.settings, autoArchive: false },
        });
      });

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Should Not Archive" });
      });

      act(() => {
        result.current.dispatch({
          type: "MOVE_CARD",
          id: result.current.state.cards[0].id,
          to: "done",
        });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            completedAt: lastMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("does not archive cards in non-terminal columns", () => {
      const { result } = renderHook(() => useAppState());

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "doing", title: "Still Working" });
      });

      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            completedAt: lastMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("returns same state reference when nothing to archive", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Active Card" });
      });

      // canUndo is true because we added a card
      expect(result.current.canUndo).toBe(true);

      // AUTO_ARCHIVE should not create a new history entry when nothing to archive
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Undo should still go back to the ADD_CARD, not an empty auto-archive
      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards).toHaveLength(0);
    });
  });
});
