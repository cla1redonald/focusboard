import React from "react";
import { nanoid } from "nanoid";
import type { AppState, Card, Column, ColumnId, Settings } from "./types";
import { loadState, saveState } from "./storage";
import { nowIso } from "./utils";

type Action =
  | { type: "ADD_CARD"; column: ColumnId; title: string }
  | { type: "UPDATE_CARD"; card: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; to: ColumnId; patch?: Partial<Card> }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "ADD_COLUMN"; column: Omit<Column, "id" | "order"> }
  | { type: "UPDATE_COLUMN"; column: Column }
  | { type: "DELETE_COLUMN"; id: ColumnId; migrateCardsTo?: ColumnId }
  | { type: "REORDER_COLUMNS"; columns: Column[] };

function reducer(state: AppState, action: Action): AppState {
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
      // Optionally migrate cards to another column
      const updatedCards = action.migrateCardsTo
        ? state.cards.map((c) =>
            c.column === action.id
              ? { ...c, column: action.migrateCardsTo!, updatedAt: nowIso() }
              : c
          )
        : state.cards.filter((c) => c.column !== action.id);

      // Remove the column and reorder
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

export function useAppState() {
  const [state, dispatch] = React.useReducer(reducer, undefined, loadState);

  React.useEffect(() => {
    saveState(state);
  }, [state]);

  return { state, dispatch };
}
