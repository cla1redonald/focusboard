import React from "react";
import { nanoid } from "nanoid";
import type { AppState, Card, CardRelation, CardTemplate, Column, ColumnId, ColumnTransition, RelationType, Settings } from "./types";
import { loadState, saveState } from "./storage";
import { nowIso } from "./utils";

const MAX_HISTORY = 50;

function getReciprocalType(type: RelationType): RelationType {
  switch (type) {
    case "blocks":
      return "blocked-by";
    case "blocked-by":
      return "blocks";
    case "parent":
      return "child";
    case "child":
      return "parent";
    case "related":
      return "related";
  }
}

type Action =
  | { type: "ADD_CARD"; column: ColumnId; title: string }
  | { type: "ADD_CARD_FROM_TEMPLATE"; templateId: string }
  | { type: "UPDATE_CARD"; card: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; to: ColumnId; patch?: Partial<Card> }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "ADD_COLUMN"; column: Omit<Column, "id" | "order"> }
  | { type: "UPDATE_COLUMN"; column: Column }
  | { type: "DELETE_COLUMN"; id: ColumnId; migrateCardsTo?: ColumnId }
  | { type: "REORDER_COLUMNS"; columns: Column[] }
  | { type: "ADD_TEMPLATE"; template: Omit<CardTemplate, "id"> }
  | { type: "UPDATE_TEMPLATE"; template: CardTemplate }
  | { type: "DELETE_TEMPLATE"; id: string }
  | { type: "ADD_RELATION"; cardId: string; targetCardId: string; relationType: RelationType }
  | { type: "REMOVE_RELATION"; cardId: string; relationId: string }
  | { type: "IMPORT_STATE"; state: AppState }
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
      const now = nowIso();
      const initialTransition: ColumnTransition = {
        from: null,
        to: action.column,
        at: now,
      };
      const card: Card = {
        id: nanoid(),
        column: action.column,
        title: action.title.trim(),
        createdAt: now,
        updatedAt: now,
        tags: [],
        checklist: [],
        columnHistory: [initialTransition],
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
      const deletedId = action.id;
      const now = nowIso();
      return {
        ...state,
        cards: state.cards
          .filter((c) => c.id !== deletedId)
          .map((c) => {
            // Remove any relations pointing to deleted card
            if (c.relations?.some((r) => r.targetCardId === deletedId)) {
              return {
                ...c,
                relations: c.relations.filter((r) => r.targetCardId !== deletedId),
                updatedAt: now,
              };
            }
            return c;
          }),
      };
    }
    case "MOVE_CARD": {
      const now = nowIso();
      const toColumn = state.columns.find((col) => col.id === action.to);
      const isTerminal = toColumn?.isTerminal ?? false;

      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id !== action.id) return c;

          const transition: ColumnTransition = {
            from: c.column,
            to: action.to,
            at: now,
          };
          const columnHistory = [...(c.columnHistory ?? []), transition];

          return {
            ...c,
            column: action.to,
            ...action.patch,
            updatedAt: now,
            columnHistory,
            completedAt: isTerminal ? now : c.completedAt,
          };
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

    case "ADD_TEMPLATE": {
      const newTemplate: CardTemplate = {
        ...action.template,
        id: nanoid(),
      };
      return { ...state, templates: [...state.templates, newTemplate] };
    }

    case "UPDATE_TEMPLATE": {
      return {
        ...state,
        templates: state.templates.map((t) =>
          t.id === action.template.id ? action.template : t
        ),
      };
    }

    case "DELETE_TEMPLATE": {
      return {
        ...state,
        templates: state.templates.filter((t) => t.id !== action.id),
      };
    }

    case "ADD_CARD_FROM_TEMPLATE": {
      const template = state.templates.find((t) => t.id === action.templateId);
      if (!template) return state;

      const now = nowIso();
      const initialTransition: ColumnTransition = {
        from: null,
        to: template.defaultColumn,
        at: now,
      };

      const card: Card = {
        id: nanoid(),
        column: template.defaultColumn,
        title: template.title,
        icon: template.icon,
        notes: template.notes,
        tags: template.tags ? [...template.tags] : [],
        checklist: template.checklist
          ? template.checklist.map((item) => ({
              id: nanoid(),
              text: item.text,
              done: item.done,
            }))
          : [],
        createdAt: now,
        updatedAt: now,
        columnHistory: [initialTransition],
      };
      return { ...state, cards: [card, ...state.cards] };
    }

    case "ADD_RELATION": {
      const { cardId, targetCardId, relationType } = action;
      if (cardId === targetCardId) return state; // Can't relate to self

      // Check if target exists
      if (!state.cards.some((c) => c.id === targetCardId)) return state;

      const now = nowIso();
      const relationId = nanoid();
      const reciprocalId = nanoid();
      const reciprocalType = getReciprocalType(relationType);

      const newRelation: CardRelation = {
        id: relationId,
        type: relationType,
        targetCardId,
      };

      const reciprocalRelation: CardRelation = {
        id: reciprocalId,
        type: reciprocalType,
        targetCardId: cardId,
      };

      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id === cardId) {
            // Check if relation already exists
            const existing = c.relations?.some(
              (r) => r.targetCardId === targetCardId && r.type === relationType
            );
            if (existing) return c;
            return {
              ...c,
              relations: [...(c.relations ?? []), newRelation],
              updatedAt: now,
            };
          }
          if (c.id === targetCardId) {
            // Check if reciprocal already exists
            const existing = c.relations?.some(
              (r) => r.targetCardId === cardId && r.type === reciprocalType
            );
            if (existing) return c;
            return {
              ...c,
              relations: [...(c.relations ?? []), reciprocalRelation],
              updatedAt: now,
            };
          }
          return c;
        }),
      };
    }

    case "REMOVE_RELATION": {
      const { cardId, relationId } = action;
      const now = nowIso();

      // Find the relation to remove
      const sourceCard = state.cards.find((c) => c.id === cardId);
      const relation = sourceCard?.relations?.find((r) => r.id === relationId);
      if (!relation) return state;

      const reciprocalType = getReciprocalType(relation.type);

      return {
        ...state,
        cards: state.cards.map((c) => {
          if (c.id === cardId) {
            return {
              ...c,
              relations: c.relations?.filter((r) => r.id !== relationId) ?? [],
              updatedAt: now,
            };
          }
          if (c.id === relation.targetCardId) {
            // Remove reciprocal relation
            return {
              ...c,
              relations:
                c.relations?.filter(
                  (r) => !(r.targetCardId === cardId && r.type === reciprocalType)
                ) ?? [],
              updatedAt: now,
            };
          }
          return c;
        }),
      };
    }

    case "IMPORT_STATE": {
      return action.state;
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
