import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAppState } from "./state";

/**
 * ARCHIVE SYSTEM EDGE CASE TESTS
 *
 * These tests cover edge cases not in the main state.test.ts file:
 * - Year boundary handling in AUTO_ARCHIVE_CARDS
 * - Double-archive idempotency
 * - Cards without completedAt field
 * - Invalid card IDs
 * - Undo/redo for all archive actions
 *
 * Expected to FAIL initially (TDD approach) until implementation is complete.
 */

describe("Archive System Edge Cases", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("ARCHIVE_CARD edge cases", () => {
    it("handles archiving non-existent card gracefully (invalid ID guard)", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Existing Card" });
      });

      const cardsBefore = result.current.state.cards.length;

      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: "non-existent-id-12345" });
      });

      // Should not throw, state should be unchanged
      expect(result.current.state.cards).toHaveLength(cardsBefore);
      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("is idempotent - archiving already archived card does not change archivedAt", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Double Archive Test" });
      });

      const cardId = result.current.state.cards[0].id;

      // First archive
      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      const firstArchivedAt = result.current.state.cards[0].archivedAt;
      expect(firstArchivedAt).toBeDefined();

      // Advance time
      vi.useFakeTimers();
      vi.advanceTimersByTime(5000);

      // Second archive - should be idempotent (no timestamp change)
      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      expect(result.current.state.cards[0].archivedAt).toBe(firstArchivedAt);
      vi.useRealTimers();
    });

    it("can be redone after undo", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Redo Test" });
      });

      const cardId = result.current.state.cards[0].id;

      // Archive
      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();

      // Undo
      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();

      // Redo
      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });
  });

  describe("UNARCHIVE_CARD edge cases", () => {
    it("handles unarchiving non-existent card gracefully", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Existing Card" });
      });

      const cardsBefore = result.current.state.cards.length;

      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: "non-existent-id-67890",
          toColumn: "todo",
        });
      });

      // Should not throw, state should be unchanged
      expect(result.current.state.cards).toHaveLength(cardsBefore);
    });

    it("handles unarchiving card that is not archived", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Active Card" });
      });

      const cardId = result.current.state.cards[0].id;

      // Try to unarchive a card that was never archived
      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: cardId,
          toColumn: "doing",
        });
      });

      // Should handle gracefully - either no-op or restore anyway
      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("can be redone after undo", () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Unarchive Redo Test" });
      });

      const cardId = result.current.state.cards[0].id;

      // Archive first
      act(() => {
        result.current.dispatch({ type: "ARCHIVE_CARD", id: cardId });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();

      // Unarchive
      act(() => {
        result.current.dispatch({
          type: "UNARCHIVE_CARD",
          id: cardId,
          toColumn: "backlog",
        });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
      expect(result.current.state.cards[0].column).toBe("backlog");

      // Undo unarchive
      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();

      // Redo unarchive
      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
      expect(result.current.state.cards[0].column).toBe("backlog");
    });
  });

  describe("AUTO_ARCHIVE_CARDS edge cases", () => {
    it("handles year boundary correctly (December to January)", () => {
      const { result } = renderHook(() => useAppState());

      // Create a card completed in December of last year
      const lastDecember = new Date();
      lastDecember.setFullYear(lastDecember.getFullYear() - 1);
      lastDecember.setMonth(11); // December (0-indexed)
      lastDecember.setDate(15);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Year Boundary Card" });
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
            completedAt: lastDecember.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });

    it("handles cards without completedAt field (should not crash)", () => {
      const { result } = renderHook(() => useAppState());

      // Create a card in terminal column but without completedAt
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "done", title: "Manual Done Card" });
      });

      // Manually set to done column without going through MOVE_CARD
      act(() => {
        result.current.dispatch({
          type: "UPDATE_CARD",
          card: {
            ...result.current.state.cards[0],
            column: "done",
            // Note: completedAt is undefined
          },
        });
      });

      expect(result.current.state.cards[0].completedAt).toBeUndefined();

      // AUTO_ARCHIVE should handle this gracefully
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Should not archive cards without completedAt
      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("handles multiple cards at month boundary efficiently", () => {
      const { result } = renderHook(() => useAppState());

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      // Create 5 cards all completed last month
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.dispatch({ type: "ADD_CARD", column: "todo", title: `Bulk Card ${i}` });
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
      }

      expect(result.current.state.cards).toHaveLength(5);

      // Auto-archive should process all 5
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      const archivedCount = result.current.state.cards.filter((c) => c.archivedAt).length;
      expect(archivedCount).toBe(5);
    });

    it("can be undone and redone", () => {
      const { result } = renderHook(() => useAppState());

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      // Create 2 cards completed last month
      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Auto Archive 1" });
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
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Auto Archive 2" });
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

      // Auto-archive both
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      const archivedCount = result.current.state.cards.filter((c) => c.archivedAt).length;
      expect(archivedCount).toBe(2);

      // Undo auto-archive
      act(() => {
        result.current.dispatch({ type: "UNDO" });
      });

      const unarchivedCount = result.current.state.cards.filter((c) => c.archivedAt).length;
      expect(unarchivedCount).toBe(0);

      // Redo auto-archive
      act(() => {
        result.current.dispatch({ type: "REDO" });
      });

      const rearchivedCount = result.current.state.cards.filter((c) => c.archivedAt).length;
      expect(rearchivedCount).toBe(2);
    });

    it("is idempotent - running twice does not double-archive or change timestamps", () => {
      const { result } = renderHook(() => useAppState());

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Idempotent Test" });
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

      // First auto-archive
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      const firstArchivedAt = result.current.state.cards[0].archivedAt;
      expect(firstArchivedAt).toBeDefined();

      // Advance time
      vi.useFakeTimers();
      vi.advanceTimersByTime(10000);

      // Second auto-archive - should be no-op (already archived)
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Timestamp should not change
      expect(result.current.state.cards[0].archivedAt).toBe(firstArchivedAt);
      vi.useRealTimers();
    });
  });

  describe("Month boundary calculation edge cases", () => {
    it("correctly identifies same month across different years", () => {
      const { result } = renderHook(() => useAppState());

      // Card completed in January 2024
      const jan2024 = new Date("2024-01-15T12:00:00.000Z");

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Old Year Card" });
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
            completedAt: jan2024.toISOString(),
          },
        });
      });

      // Run auto-archive in February 2026 (current test time)
      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Should archive (different year + month)
      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });

    it("does not archive cards completed on the first day of current month", () => {
      const { result } = renderHook(() => useAppState());

      // Card completed on the 1st of this month
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "First Day Card" });
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
            completedAt: firstOfMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Should NOT archive (same month)
      expect(result.current.state.cards[0].archivedAt).toBeUndefined();
    });

    it("archives cards completed on last day of previous month", () => {
      const { result } = renderHook(() => useAppState());

      // Card completed on last day of last month
      const now = new Date();
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

      act(() => {
        result.current.dispatch({ type: "ADD_CARD", column: "todo", title: "Last Day Card" });
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
            completedAt: lastDayLastMonth.toISOString(),
          },
        });
      });

      act(() => {
        result.current.dispatch({ type: "AUTO_ARCHIVE_CARDS" });
      });

      // Should archive (previous month)
      expect(result.current.state.cards[0].archivedAt).toBeDefined();
    });
  });
});
