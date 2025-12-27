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
      expect(orders).toEqual([0, 1, 2, 3, 4]);
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

      expect(result.current.state.columns[0].id).toBe("done");
      expect(result.current.state.columns[0].order).toBe(0);
      expect(result.current.state.columns[5].id).toBe("backlog");
      expect(result.current.state.columns[5].order).toBe(5);
    });
  });

  describe("state persistence", () => {
    it("saves state to localStorage on every state change", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({
          type: "ADD_CARD",
          column: "todo",
          title: "New Card",
        });
      });

      // Check that localStorage.setItem was called
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "focusboard:v2",
        expect.any(String)
      );
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
});
