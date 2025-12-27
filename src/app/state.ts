import React from "react";
import { nanoid } from "nanoid";
import type { AppState, Card, Column, ColumnId, Settings } from "./types";
import { loadState, saveState } from "./storage";
import { nowIso } from "./utils";

const MAX_HISTORY = 50;

type Action =
  | { type: "ADD_CARD"; column: ColumnId; title: string }
  | { type: "UPDATE_CARD"; card: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; to: ColumnId; patch?: Partial<Card> }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "ADD_COLUMN"; column: Omit<Column, "id" | "order"> }
  | { type: "UPDATE_COLUMN"; column: Column }
  | { type: "DELETE_COLUMN"; id: ColumnId; migrateCardsTo?: ColumnId }
  | { type: "REORDER_COLUMNS"; columns: Column[] }
  | { type: "UNDO" }
  | { type: "REDO" };

type HistoryState = {
  past: AppState[];
  present: AppState;
  future: AppState[];
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_CARD": {
      const card: Card = {
        id: nanoid(),
        column: action.column,
        title: action.title.trim(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        tags: [],
        checklist: [],
      };
      return { ...state, cards: [card, ...state.cards] };
    }
    case "UPDATE_CARD": {
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.card.id ? { ...action.card, updatedAt: nowIso() } : c
        ),
      };
    }
    case "DELETE_CARD": {
      return { ...state, cards: state.cards.filter((c) => c.id !== action.id) };
    }
    case "MOVE_CARD": {
      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.id) return c;
          return { ...c, column: action.to, ...action.patch, updatedAt: nowIso() };
        }),
      };
    }
    case "SET_SETTINGS":
      return { ...state, settings: action.settings };

    case "ADD_COLUMN": {
      const newColumn: Column = {
        ...action.column,
        id: nanoid(),
        order: state.columns.length,
      };
      return { ...state, columns: [...state.columns, newColumn] };
    }

    case "UPDATE_COLUMN": {
      return {
        ...state,
        columns: state.columns.map((c) =>
          c.id === action.column.id ? action.column : c
        ),
      };
    }

    case "DELETE_COLUMN": {
      const updatedCards = action.migrateCardsTo
        ? state.cards.map((c) =>
            c.column === action.id
              ? { ...c, column: action.migrateCardsTo!, updatedAt: nowIso() }
              : c
          )
        : state.cards.filter((c) => c.column !== action.id);

      const remainingColumns = state.columns
        .filter((c) => c.id !== action.id)
        .map((c, idx) => ({ ...c, order: idx }));

      return { ...state, cards: updatedCards, columns: remainingColumns };
    }

    case "REORDER_COLUMNS": {
      return {
        ...state,
        columns: action.columns.map((c, idx) => ({ ...c, order: idx })),
      };
    }

    default:
      return state;
  }
}

function historyReducer(historyState: HistoryState, action: Action): HistoryState {
  const { past, present, future } = historyState;

  if (action.type === "UNDO") {
    if (past.length === 0) return historyState;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    return {
      past: newPast,
      present: previous,
      future: [present, ...future],
    };
  }

  if (action.type === "REDO") {
    if (future.length === 0) return historyState;
    const next = future[0];
    const newFuture = future.slice(1);
    return {
      past: [...past, present],
      present: next,
      future: newFuture,
    };
  }

  // For all other actions, apply to present and add to history
  const newPresent = appReducer(present, action);

  // If state didn't change, don't add to history
  if (newPresent === present) return historyState;

  return {
    past: [...past, present].slice(-MAX_HISTORY),
    present: newPresent,
    future: [], // Clear future on new action
  };
}

function initHistory(initialState: AppState): HistoryState {
  return {
    past: [],
    present: initialState,
    future: [],
  };
}

export function useAppState() {
  const [historyState, dispatch] = React.useReducer(
    historyReducer,
    undefined,
    () => initHistory(loadState())
  );

  const { present: state, past, future } = historyState;

  React.useEffect(() => {
    saveState(state);
  }, [state]);

  // Keyboard shortcuts for undo/redo
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    state,
    dispatch,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
