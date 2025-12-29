import React from "react";
import { nanoid } from "nanoid";
import type { AppState, Card, CardRelation, CardTemplate, Column, ColumnId, ColumnTransition, RelationType, Settings, SwimlaneId, Tag, TagCategory } from "./types";
import { loadState, saveState, setStorageUserId } from "./storage";
import { nowIso, suggestEmojiForTitle, suggestTagsForTitle } from "./utils";
import { calculateAutoPriority } from "./urgency";
import { loadStateFromSupabase, debouncedSaveToSupabase, subscribeToStateChanges } from "./sync";
import { supabase } from "./supabase";

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
  | { type: "ADD_CARD"; column: ColumnId; title: string; swimlane?: SwimlaneId }
  | { type: "ADD_CARD_FROM_TEMPLATE"; templateId: string; swimlane?: SwimlaneId }
  | { type: "UPDATE_CARD"; card: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "MOVE_CARD"; id: string; to: ColumnId; toSwimlane?: SwimlaneId; patch?: Partial<Card> }
  | { type: "REORDER_CARDS"; columnId: ColumnId; cardIds: string[]; swimlane?: SwimlaneId }
  | { type: "SET_SETTINGS"; settings: Settings }
  | { type: "TOGGLE_SWIMLANE_COLLAPSE"; swimlaneId: SwimlaneId }
  | { type: "ADD_COLUMN"; column: Omit<Column, "id" | "order"> }
  | { type: "UPDATE_COLUMN"; column: Column }
  | { type: "DELETE_COLUMN"; id: ColumnId; migrateCardsTo?: ColumnId }
  | { type: "REORDER_COLUMNS"; columns: Column[] }
  | { type: "ADD_TEMPLATE"; template: Omit<CardTemplate, "id"> }
  | { type: "UPDATE_TEMPLATE"; template: CardTemplate }
  | { type: "DELETE_TEMPLATE"; id: string }
  | { type: "ADD_RELATION"; cardId: string; targetCardId: string; relationType: RelationType }
  | { type: "REMOVE_RELATION"; cardId: string; relationId: string }
  | { type: "ADD_TAG"; tag: Omit<Tag, "id"> }
  | { type: "UPDATE_TAG"; tag: Tag }
  | { type: "DELETE_TAG"; id: string }
  | { type: "ADD_TAG_CATEGORY"; category: Omit<TagCategory, "id" | "order"> }
  | { type: "UPDATE_TAG_CATEGORY"; category: TagCategory }
  | { type: "DELETE_TAG_CATEGORY"; id: string }
  | { type: "REORDER_TAG_CATEGORIES"; categories: TagCategory[] }
  | { type: "IMPORT_STATE"; state: AppState }
  | { type: "APPLY_AUTO_PRIORITIES" }
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
      const swimlane = action.swimlane ?? "work";
      const initialTransition: ColumnTransition = {
        from: null,
        to: action.column,
        at: now,
      };
      // New cards go to top (order 0), shift existing cards in same column AND swimlane
      const shiftedCards = state.cards.map((c) =>
        c.column === action.column && (c.swimlane ?? "work") === swimlane
          ? { ...c, order: (c.order ?? 0) + 1 }
          : c
      );

      // Smart suggestions based on title keywords
      const suggestedEmoji = suggestEmojiForTitle(action.title);
      const availableTagIds = state.tags.map((t) => t.id);
      const suggestedTags = suggestTagsForTitle(action.title, availableTagIds);

      const card: Card = {
        id: nanoid(),
        column: action.column,
        swimlane,
        title: action.title.trim(),
        order: 0,
        createdAt: now,
        updatedAt: now,
        icon: suggestedEmoji,
        tags: suggestedTags,
        checklist: [],
        columnHistory: [initialTransition],
      };
      return { ...state, cards: [card, ...shiftedCards] };
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
      const movingCard = state.cards.find((c) => c.id === action.id);
      const fromColumn = movingCard?.column;
      const fromSwimlane = movingCard?.swimlane ?? "work";
      const toSwimlane = action.toSwimlane ?? fromSwimlane;

      // Shift cards in destination column AND swimlane to make room at top
      const shiftedCards = state.cards.map((c) => {
        if (c.id === action.id) return c; // Will be updated below
        if (c.column === action.to && (c.swimlane ?? "work") === toSwimlane) {
          return { ...c, order: (c.order ?? 0) + 1 };
        }
        return c;
      });

      return {
        ...state,
        cards: shiftedCards.map((c) => {
          if (c.id !== action.id) return c;

          const transition: ColumnTransition = {
            from: fromColumn ?? null,
            to: action.to,
            at: now,
          };
          const columnHistory = [...(c.columnHistory ?? []), transition];

          return {
            ...c,
            column: action.to,
            swimlane: toSwimlane,
            order: 0, // Move to top of new column
            ...action.patch,
            updatedAt: now,
            columnHistory,
            completedAt: isTerminal ? now : c.completedAt,
          };
        }),
      };
    }
    case "REORDER_CARDS": {
      const { columnId, cardIds, swimlane } = action;
      const targetSwimlane = swimlane ?? "work";
      const now = nowIso();
      return {
        ...state,
        cards: state.cards.map((c) => {
          // Only reorder cards in the same column AND swimlane
          if (c.column !== columnId || (c.swimlane ?? "work") !== targetSwimlane) return c;
          const newOrder = cardIds.indexOf(c.id);
          if (newOrder === -1) return c;
          return { ...c, order: newOrder, updatedAt: now };
        }),
      };
    }
    case "SET_SETTINGS":
      return { ...state, settings: action.settings };

    case "TOGGLE_SWIMLANE_COLLAPSE": {
      const { swimlaneId } = action;
      const collapsed = state.settings.collapsedSwimlanes ?? [];
      const isCollapsed = collapsed.includes(swimlaneId);
      return {
        ...state,
        settings: {
          ...state.settings,
          collapsedSwimlanes: isCollapsed
            ? collapsed.filter((id) => id !== swimlaneId)
            : [...collapsed, swimlaneId],
        },
      };
    }

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
      const swimlane = action.swimlane ?? "work";
      const initialTransition: ColumnTransition = {
        from: null,
        to: template.defaultColumn,
        at: now,
      };

      // Shift existing cards in same column AND swimlane
      const shiftedCards = state.cards.map((c) =>
        c.column === template.defaultColumn && (c.swimlane ?? "work") === swimlane
          ? { ...c, order: (c.order ?? 0) + 1 }
          : c
      );

      const card: Card = {
        id: nanoid(),
        column: template.defaultColumn,
        swimlane,
        title: template.title,
        order: 0,
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
      return { ...state, cards: [card, ...shiftedCards] };
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

    case "ADD_TAG": {
      const newTag: Tag = {
        ...action.tag,
        id: nanoid(),
      };
      return { ...state, tags: [...state.tags, newTag] };
    }

    case "UPDATE_TAG": {
      return {
        ...state,
        tags: state.tags.map((t) =>
          t.id === action.tag.id ? action.tag : t
        ),
      };
    }

    case "DELETE_TAG": {
      // Remove tag from all cards that have it
      const updatedCards = state.cards.map((c) => {
        if (c.tags?.includes(action.id)) {
          return {
            ...c,
            tags: c.tags.filter((t) => t !== action.id),
            updatedAt: nowIso(),
          };
        }
        return c;
      });
      return {
        ...state,
        tags: state.tags.filter((t) => t.id !== action.id),
        cards: updatedCards,
      };
    }

    case "ADD_TAG_CATEGORY": {
      const newCategory: TagCategory = {
        ...action.category,
        id: nanoid(),
        order: state.tagCategories.length,
      };
      return { ...state, tagCategories: [...state.tagCategories, newCategory] };
    }

    case "UPDATE_TAG_CATEGORY": {
      return {
        ...state,
        tagCategories: state.tagCategories.map((c) =>
          c.id === action.category.id ? action.category : c
        ),
      };
    }

    case "DELETE_TAG_CATEGORY": {
      // Delete all tags in this category and remove from cards
      const tagsToDelete = state.tags.filter((t) => t.categoryId === action.id).map((t) => t.id);
      const updatedCards = state.cards.map((c) => {
        if (c.tags?.some((t) => tagsToDelete.includes(t))) {
          return {
            ...c,
            tags: c.tags.filter((t) => !tagsToDelete.includes(t)),
            updatedAt: nowIso(),
          };
        }
        return c;
      });
      const remainingCategories = state.tagCategories
        .filter((c) => c.id !== action.id)
        .map((c, idx) => ({ ...c, order: idx }));
      return {
        ...state,
        tagCategories: remainingCategories,
        tags: state.tags.filter((t) => t.categoryId !== action.id),
        cards: updatedCards,
      };
    }

    case "REORDER_TAG_CATEGORIES": {
      return {
        ...state,
        tagCategories: action.categories.map((c, idx) => ({ ...c, order: idx })),
      };
    }

    case "IMPORT_STATE": {
      return action.state;
    }

    case "APPLY_AUTO_PRIORITIES": {
      // Only apply if the setting is enabled
      if (!state.settings.autoPriorityFromDueDate) return state;

      const now = nowIso();
      let hasChanges = false;

      const updatedCards = state.cards.map((card) => {
        const priorityTagId = calculateAutoPriority(card, card.tags ?? []);
        if (!priorityTagId) return card;

        hasChanges = true;
        return {
          ...card,
          tags: [...(card.tags ?? []), priorityTagId],
          updatedAt: now,
        };
      });

      if (!hasChanges) return state;
      return { ...state, cards: updatedCards };
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

export function useAppState(userId?: string | null) {
  // Set storage userId BEFORE loading state to ensure user-scoped keys
  // This fixes the race condition where loadState ran before userId was set
  if (userId !== undefined) {
    setStorageUserId(userId);
  }

  const [historyState, dispatch] = React.useReducer(
    historyReducer,
    undefined,
    () => initHistory(loadState())
  );

  const { present: state, past, future } = historyState;

  // Track if we've loaded from cloud to avoid overwriting
  const hasLoadedFromCloud = React.useRef(false);
  const isExternalUpdate = React.useRef(false);
  const lastLocalSaveTime = React.useRef<number>(0);

  // Load from Supabase on startup (if logged in)
  React.useEffect(() => {
    if (!supabase) return;

    const loadFromCloud = async () => {
      const cloudState = await loadStateFromSupabase();
      if (cloudState && !hasLoadedFromCloud.current) {
        hasLoadedFromCloud.current = true;
        isExternalUpdate.current = true;
        dispatch({ type: "IMPORT_STATE", state: cloudState });
      }
    };

    loadFromCloud();
  }, []);

  // Subscribe to real-time changes from Supabase
  React.useEffect(() => {
    if (!supabase) return;

    const unsubscribe = subscribeToStateChanges((cloudState) => {
      // Ignore updates that arrive within 3 seconds of our own save
      // (these are likely echoes of our own changes)
      const timeSinceLastSave = Date.now() - lastLocalSaveTime.current;
      if (timeSinceLastSave < 3000) {
        return;
      }

      // Only update if this wasn't triggered by our own save
      isExternalUpdate.current = true;
      dispatch({ type: "IMPORT_STATE", state: cloudState });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Save to localStorage and Supabase when state changes
  React.useEffect(() => {
    saveState(state);

    // Don't save to cloud if this was an external update (to avoid loops)
    if (isExternalUpdate.current) {
      isExternalUpdate.current = false;
      return;
    }

    // Save to Supabase (debounced)
    if (supabase) {
      lastLocalSaveTime.current = Date.now();
      debouncedSaveToSupabase(state);
    }
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
