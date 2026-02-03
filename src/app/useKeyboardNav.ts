import React from "react";
import type { Card, Column } from "./types";

export type FocusPosition = {
  columnIndex: number;
  cardIndex: number | null; // null means column header is focused
};

export function useKeyboardNav({
  columns,
  cardsByColumn,
  onOpenCard,
  onDeleteCard,
  onAddCard,
  onMoveToColumn,
  enabled = true,
}: {
  columns: Column[];
  cardsByColumn: Record<string, Card[]>;
  onOpenCard: (card: Card) => void;
  onDeleteCard: (id: string) => void;
  onAddCard: (columnId: string) => void;
  onMoveToColumn?: (cardId: string, columnId: string) => void;
  enabled?: boolean;
}) {
  const [focusPosition, setFocusPosition] = React.useState<FocusPosition | null>(null);
  const [isNavigating, setIsNavigating] = React.useState(false);

  const sortedColumns = React.useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns]
  );

  const getFocusedCard = React.useCallback((): Card | null => {
    const cardIndex = focusPosition?.cardIndex;
    const column = focusPosition ? sortedColumns[focusPosition.columnIndex] : undefined;
    if (cardIndex === null || cardIndex === undefined || !column) return null;
    const cards = cardsByColumn[column.id] ?? [];
    return cards[cardIndex] ?? null;
  }, [focusPosition, sortedColumns, cardsByColumn]);

  const getFocusedColumnId = React.useCallback((): string | null => {
    if (!focusPosition) return null;
    return sortedColumns[focusPosition.columnIndex]?.id ?? null;
  }, [focusPosition, sortedColumns]);

  // Clear focus when disabled or when clicking outside
  React.useEffect(() => {
    if (!enabled) {
      setFocusPosition(null);
      setIsNavigating(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with input/textarea typing
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // ? shows help
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        // This will be handled by App.tsx
        return;
      }

      // Start navigation with arrow keys if not already navigating
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        !focusPosition
      ) {
        e.preventDefault();
        setIsNavigating(true);
        setFocusPosition({ columnIndex: 0, cardIndex: null });
        return;
      }

      if (!focusPosition) return;

      const currentColumnId = sortedColumns[focusPosition.columnIndex]?.id;
      const currentCards = currentColumnId ? cardsByColumn[currentColumnId] ?? [] : [];

      switch (e.key) {
        case "ArrowLeft": {
          e.preventDefault();
          if (focusPosition.columnIndex > 0) {
            const newColIndex = focusPosition.columnIndex - 1;
            const newColId = sortedColumns[newColIndex]?.id;
            const newColCards = newColId ? cardsByColumn[newColId] ?? [] : [];
            setFocusPosition({
              columnIndex: newColIndex,
              cardIndex:
                focusPosition.cardIndex !== null
                  ? Math.min(focusPosition.cardIndex, newColCards.length - 1)
                  : null,
            });
          }
          break;
        }

        case "ArrowRight": {
          e.preventDefault();
          if (focusPosition.columnIndex < sortedColumns.length - 1) {
            const newColIndex = focusPosition.columnIndex + 1;
            const newColId = sortedColumns[newColIndex]?.id;
            const newColCards = newColId ? cardsByColumn[newColId] ?? [] : [];
            setFocusPosition({
              columnIndex: newColIndex,
              cardIndex:
                focusPosition.cardIndex !== null
                  ? Math.min(focusPosition.cardIndex, Math.max(0, newColCards.length - 1))
                  : null,
            });
          }
          break;
        }

        case "ArrowDown": {
          e.preventDefault();
          if (focusPosition.cardIndex === null) {
            // Move from column header to first card
            if (currentCards.length > 0) {
              setFocusPosition({ ...focusPosition, cardIndex: 0 });
            }
          } else if (focusPosition.cardIndex < currentCards.length - 1) {
            setFocusPosition({
              ...focusPosition,
              cardIndex: focusPosition.cardIndex + 1,
            });
          }
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          if (focusPosition.cardIndex === null) {
            // Already at column header, do nothing
          } else if (focusPosition.cardIndex === 0) {
            // Move to column header
            setFocusPosition({ ...focusPosition, cardIndex: null });
          } else {
            setFocusPosition({
              ...focusPosition,
              cardIndex: focusPosition.cardIndex - 1,
            });
          }
          break;
        }

        case "Enter": {
          e.preventDefault();
          const card = getFocusedCard();
          if (card) {
            onOpenCard(card);
          }
          break;
        }

        case "n":
        case "N": {
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const colId = getFocusedColumnId();
            if (colId) {
              onAddCard(colId);
            }
          }
          break;
        }

        case "d":
        case "D": {
          if (!e.metaKey && !e.ctrlKey && onMoveToColumn) {
            const card = getFocusedCard();
            const doneColumn = sortedColumns.find((c) => c.isTerminal);
            if (card && doneColumn && card.column !== doneColumn.id) {
              e.preventDefault();
              onMoveToColumn(card.id, doneColumn.id);
            }
          }
          break;
        }

        case "Delete":
        case "Backspace": {
          if (!e.metaKey && !e.ctrlKey) {
            const card = getFocusedCard();
            if (card) {
              e.preventDefault();
              onDeleteCard(card.id);
              // Adjust focus after deletion
              if (focusPosition.cardIndex !== null) {
                const newCardCount = currentCards.length - 1;
                if (newCardCount === 0) {
                  setFocusPosition({ ...focusPosition, cardIndex: null });
                } else if (focusPosition.cardIndex >= newCardCount) {
                  setFocusPosition({
                    ...focusPosition,
                    cardIndex: newCardCount - 1,
                  });
                }
              }
            }
          }
          break;
        }

        case "Escape": {
          e.preventDefault();
          setFocusPosition(null);
          setIsNavigating(false);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    focusPosition,
    sortedColumns,
    cardsByColumn,
    getFocusedCard,
    getFocusedColumnId,
    onOpenCard,
    onDeleteCard,
    onAddCard,
    onMoveToColumn,
  ]);

  // Click handler to clear keyboard focus
  React.useEffect(() => {
    const handleClick = () => {
      if (isNavigating) {
        setFocusPosition(null);
        setIsNavigating(false);
      }
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [isNavigating]);

  return {
    focusPosition,
    isNavigating,
    getFocusedCard,
    getFocusedColumnId,
    clearFocus: () => {
      setFocusPosition(null);
      setIsNavigating(false);
    },
  };
}
