import React from "react";
import { nanoid } from "nanoid";
import type { AppState, Card, ColumnId, Settings } from "./types";
import { loadState, saveState } from "./storage";
import { nowIso } from "./utils";

type Action =
  | { type: "ADD_CARD"; column: ColumnId; title: string }
  | { type: "UPDATE_CARD"; card: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; to: ColumnId; patch?: Partial<Card> }
  | { type: "SET_SETTINGS"; settings: Settings };

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
