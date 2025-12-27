import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyboardNav } from "./useKeyboardNav";
import type { Card, Column } from "./types";

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  id: `card-${Math.random().toString(36).slice(2)}`,
  column: "todo",
  title: "Test Card",
  order: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const makeColumns = (): Column[] => [
  { id: "backlog", title: "Backlog", icon: "📋", color: "#6b7280", wipLimit: null, isTerminal: false, order: 0 },
  { id: "todo", title: "To Do", icon: "📝", color: "#3b82f6", wipLimit: null, isTerminal: false, order: 1 },
  { id: "doing", title: "Doing", icon: "🔧", color: "#f59e0b", wipLimit: 1, isTerminal: false, order: 2 },
  { id: "done", title: "Done", icon: "✅", color: "#22c55e", wipLimit: null, isTerminal: true, order: 3 },
];

describe("useKeyboardNav", () => {
  const mockOnOpenCard = vi.fn();
  const mockOnDeleteCard = vi.fn();
  const mockOnAddCard = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any event listeners
  });

  const renderNavHook = (
    columns: Column[] = makeColumns(),
    cardsByColumn: Record<string, Card[]> = {},
    enabled = true
  ) => {
    return renderHook(() =>
      useKeyboardNav({
        columns,
        cardsByColumn,
        onOpenCard: mockOnOpenCard,
        onDeleteCard: mockOnDeleteCard,
        onAddCard: mockOnAddCard,
        enabled,
      })
    );
  };

  describe("initial state", () => {
    it("starts with no focus position", () => {
      const { result } = renderNavHook();
      expect(result.current.focusPosition).toBeNull();
      expect(result.current.isNavigating).toBe(false);
    });

    it("returns null from getFocusedCard when not navigating", () => {
      const { result } = renderNavHook();
      expect(result.current.getFocusedCard()).toBeNull();
    });

    it("returns null from getFocusedColumnId when not navigating", () => {
      const { result } = renderNavHook();
      expect(result.current.getFocusedColumnId()).toBeNull();
    });
  });

  describe("arrow key navigation", () => {
    it("starts navigation on ArrowRight", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      expect(result.current.isNavigating).toBe(true);
      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: null });
    });

    it("starts navigation on ArrowLeft", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      });

      expect(result.current.isNavigating).toBe(true);
      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: null });
    });

    it("moves right between columns", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 1, cardIndex: null });
    });

    it("moves left between columns", () => {
      const { result } = renderNavHook();

      // Start and move right twice
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: null });
    });

    it("does not move left past first column", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: null });
    });

    it("does not move right past last column", () => {
      const columns = makeColumns();
      const { result } = renderNavHook(columns);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      // Move to last column
      for (let i = 0; i < columns.length; i++) {
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        });
      }

      expect(result.current.focusPosition?.columnIndex).toBe(columns.length - 1);
    });

    it("moves down into cards", () => {
      const card1 = makeCard({ id: "card-1" });
      const card2 = makeCard({ id: "card-2" });
      const { result } = renderNavHook(makeColumns(), { backlog: [card1, card2] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: 0 });
    });

    it("moves down between cards", () => {
      const card1 = makeCard({ id: "card-1" });
      const card2 = makeCard({ id: "card-2" });
      const { result } = renderNavHook(makeColumns(), { backlog: [card1, card2] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: 1 });
    });

    it("moves up back to column header", () => {
      const card1 = makeCard({ id: "card-1" });
      const { result } = renderNavHook(makeColumns(), { backlog: [card1] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
      });

      expect(result.current.focusPosition).toEqual({ columnIndex: 0, cardIndex: null });
    });
  });

  describe("card operations", () => {
    it("calls onOpenCard on Enter when card is focused", () => {
      const card1 = makeCard({ id: "card-1", title: "Test Card 1" });
      renderNavHook(makeColumns(), { backlog: [card1] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });

      expect(mockOnOpenCard).toHaveBeenCalledWith(card1);
    });

    it("does not call onOpenCard on Enter when column header is focused", () => {
      renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      });

      expect(mockOnOpenCard).not.toHaveBeenCalled();
    });

    it("calls onDeleteCard on Delete when card is focused", () => {
      const card1 = makeCard({ id: "card-1" });
      renderNavHook(makeColumns(), { backlog: [card1] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      });

      expect(mockOnDeleteCard).toHaveBeenCalledWith("card-1");
    });

    it("calls onAddCard on N key", () => {
      renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
      });

      expect(mockOnAddCard).toHaveBeenCalledWith("backlog");
    });
  });

  describe("escape and clear", () => {
    it("clears navigation on Escape", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      expect(result.current.isNavigating).toBe(true);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.focusPosition).toBeNull();
    });

    it("clearFocus function works", () => {
      const { result } = renderNavHook();

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      act(() => {
        result.current.clearFocus();
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.focusPosition).toBeNull();
    });
  });

  describe("disabled state", () => {
    it("does not respond to keys when disabled", () => {
      const { result } = renderNavHook(makeColumns(), {}, false);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.focusPosition).toBeNull();
    });

    it("clears focus when disabled", () => {
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useKeyboardNav({
            columns: makeColumns(),
            cardsByColumn: {},
            onOpenCard: mockOnOpenCard,
            onDeleteCard: mockOnDeleteCard,
            onAddCard: mockOnAddCard,
            enabled,
          }),
        { initialProps: { enabled: true } }
      );

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      expect(result.current.isNavigating).toBe(true);

      rerender({ enabled: false });

      expect(result.current.isNavigating).toBe(false);
      expect(result.current.focusPosition).toBeNull();
    });
  });

  describe("getFocusedCard", () => {
    it("returns the focused card", () => {
      const card1 = makeCard({ id: "card-1", title: "Card 1" });
      const card2 = makeCard({ id: "card-2", title: "Card 2" });
      const { result } = renderNavHook(makeColumns(), { backlog: [card1, card2] });

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });

      expect(result.current.getFocusedCard()).toEqual(card1);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      });

      expect(result.current.getFocusedCard()).toEqual(card2);
    });
  });

  describe("getFocusedColumnId", () => {
    it("returns the focused column id", () => {
      const columns = makeColumns();
      const { result } = renderNavHook(columns);

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      expect(result.current.getFocusedColumnId()).toBe("backlog");

      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      });

      expect(result.current.getFocusedColumnId()).toBe("todo");
    });
  });
});
