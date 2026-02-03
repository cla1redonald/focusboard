import type { AppState, Card, CardLink, Column, Tag, TagCategory } from "./types";
import { nanoid } from "nanoid";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "./constants";

// Current user ID for scoped storage (set when user logs in)
let currentUserId: string | null = null;

export function setStorageUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getStorageUserId(): string | null {
  return currentUserId;
}

// Storage key helper - scopes by user ID when available
function getStorageKey(baseKey: string): string {
  if (currentUserId) {
    return `${baseKey}:${currentUserId}`;
  }
  return baseKey;
}

const KEY_V1 = "focusboard:v1";

// Map emoji icons to Lucide icon names for migration
const EMOJI_TO_LUCIDE: Record<string, string> = {
  "📦": "archive",
  "🎨": "palette",
  "📋": "list-todo",
  "⚡": "zap",
  "🚫": "ban",
  "✅": "check-circle",
  "💡": "lightbulb",
  "🚀": "rocket",
  "🎯": "target",
  "🧠": "brain",
  "🔥": "flame",
};
const KEY_V2 = "focusboard:v2";
const KEY_V3 = "focusboard:v3";
const KEY_V4 = "focusboard:v4";

type V1Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean;
  backgroundImage: string | null;
  columnColors: Record<string, string>;
  columnIcons: Record<string, string>;
  wip: {
    design: number;
    todo: number;
    doing: number;
    blocked: number;
  };
};

type V1State = {
  cards: { id: string; column: string; title: string; [key: string]: unknown }[];
  settings: Partial<V1Settings>;
};

function migrateV1ToV2(v1State: V1State): Omit<AppState, "tagCategories" | "tags"> {
  const v1Settings = v1State.settings || {};

  // Build columns from v1 settings
  const columns: Column[] = DEFAULT_COLUMNS.map((col) => ({
    ...col,
    color: v1Settings.columnColors?.[col.id] ?? col.color,
    icon: v1Settings.columnIcons?.[col.id] ?? col.icon,
    wipLimit: col.id === "backlog" || col.id === "done"
      ? null
      : (v1Settings.wip as Record<string, number>)?.[col.id] ?? col.wipLimit,
  }));

  // Ensure cards have required fields
  const cards = (v1State.cards ?? []).map((c) => ({
    ...c,
    createdAt: c.createdAt ?? new Date().toISOString(),
    updatedAt: c.updatedAt ?? new Date().toISOString(),
    tags: c.tags ?? [],
    checklist: c.checklist ?? [],
  })) as Card[];

  return {
    cards,
    columns,
    templates: [],
    settings: {
      celebrations: v1Settings.celebrations ?? DEFAULT_SETTINGS.celebrations,
      reducedMotionOverride: v1Settings.reducedMotionOverride ?? DEFAULT_SETTINGS.reducedMotionOverride,
      backgroundImage: v1Settings.backgroundImage ?? DEFAULT_SETTINGS.backgroundImage,
      showAgingIndicators: DEFAULT_SETTINGS.showAgingIndicators,
      staleCardThreshold: DEFAULT_SETTINGS.staleCardThreshold,
      autoPriorityFromDueDate: DEFAULT_SETTINGS.autoPriorityFromDueDate,
      staleBacklogThreshold: DEFAULT_SETTINGS.staleBacklogThreshold,
      collapsedSwimlanes: DEFAULT_SETTINGS.collapsedSwimlanes,
      theme: DEFAULT_SETTINGS.theme,
      autoArchive: DEFAULT_SETTINGS.autoArchive,
    },
  };
}

type V2State = Omit<AppState, "tagCategories" | "tags"> & {
  tagCategories?: TagCategory[];
  tags?: Tag[];
};

function migrateV2ToV3(v2State: V2State): AppState {
  // If already has tags system, just ensure defaults exist
  if (v2State.tagCategories?.length && v2State.tags?.length) {
    return {
      ...v2State,
      tagCategories: v2State.tagCategories,
      tags: v2State.tags,
    };
  }

  // Start with default categories and tags
  const tagCategories = [...DEFAULT_TAG_CATEGORIES];
  const tags = [...DEFAULT_TAGS];

  // Create a "Custom" category for unmatched tags
  const customCategoryId = "custom";
  let hasCustomTags = false;

  // Build a map of tag names (lowercase) to tag IDs
  const tagNameToId = new Map<string, string>();
  for (const tag of DEFAULT_TAGS) {
    tagNameToId.set(tag.name.toLowerCase(), tag.id);
  }

  // Random colors for custom tags
  const customColors = ["#EC4899", "#14B8A6", "#F97316", "#84CC16", "#A855F7"];
  let colorIndex = 0;

  // Migrate cards: convert string tags to tag IDs
  const migratedCards = v2State.cards.map((card) => {
    if (!card.tags || card.tags.length === 0) return card;

    const newTags: string[] = [];

    for (const tagStr of card.tags) {
      // Check if it's already a valid tag ID
      if (tags.some((t) => t.id === tagStr)) {
        newTags.push(tagStr);
        continue;
      }

      // Try to match by name
      const matchedId = tagNameToId.get(tagStr.toLowerCase());
      if (matchedId) {
        newTags.push(matchedId);
        continue;
      }

      // Create a custom tag for unmatched strings
      const customTagId = `custom-${tagStr.toLowerCase().replace(/\s+/g, "-")}`;
      if (!tags.some((t) => t.id === customTagId)) {
        tags.push({
          id: customTagId,
          name: tagStr,
          color: customColors[colorIndex % customColors.length],
          categoryId: customCategoryId,
        });
        colorIndex++;
        hasCustomTags = true;
      }
      newTags.push(customTagId);
    }

    return { ...card, tags: newTags };
  });

  // Add custom category if needed
  if (hasCustomTags) {
    tagCategories.push({
      id: customCategoryId,
      name: "Custom",
      order: tagCategories.length,
    });
  }

  return {
    cards: migratedCards,
    columns: v2State.columns,
    templates: v2State.templates,
    settings: v2State.settings,
    tagCategories,
    tags,
  };
}

type V3Card = Omit<Card, "order"> & { order?: number };
type V3State = Omit<AppState, "cards"> & { cards: V3Card[] };

function migrateV3ToV4(v3State: V3State): AppState {
  // Group cards by column and assign order based on array position
  const cardsByColumn: Record<string, V3Card[]> = {};
  for (const card of v3State.cards) {
    if (!cardsByColumn[card.column]) {
      cardsByColumn[card.column] = [];
    }
    cardsByColumn[card.column].push(card);
  }

  // Assign order to cards within each column, and add swimlane
  const migratedCards: Card[] = v3State.cards.map((card) => {
    const columnCards = cardsByColumn[card.column] ?? [];
    const orderInColumn = columnCards.indexOf(card);
    return {
      ...card,
      order: card.order ?? orderInColumn,
      swimlane: "work", // Default all migrated cards to work swimlane
    };
  });

  return {
    ...v3State,
    cards: migratedCards,
    settings: {
      ...DEFAULT_SETTINGS,
      ...v3State.settings,
    },
  };
}

function getDefaultState(): AppState {
  return {
    cards: [],
    columns: DEFAULT_COLUMNS,
    templates: [],
    settings: DEFAULT_SETTINGS,
    tagCategories: DEFAULT_TAG_CATEGORIES,
    tags: DEFAULT_TAGS,
  };
}

export function loadState(): AppState {
  try {
    // If logged in, only use user-scoped key (no fallback to global)
    // This prevents new users from seeing other users' data
    const scopedKey = getStorageKey(KEY_V4);
    let rawV4 = localStorage.getItem(scopedKey);

    // Only fall back to global key if NOT logged in (local-only mode)
    if (!rawV4 && !currentUserId) {
      rawV4 = localStorage.getItem(KEY_V4);
    }
    if (rawV4) {
      const parsed = JSON.parse(rawV4) as AppState;
      // Ensure required categories exist (goals and custom)
      let tagCategories = parsed.tagCategories?.length ? parsed.tagCategories : DEFAULT_TAG_CATEGORIES;
      let tags = parsed.tags?.length ? parsed.tags : DEFAULT_TAGS;

      // Add Goals category if missing (was added after initial release)
      if (!tagCategories.some((c) => c.id === "goals")) {
        // Insert Goals at the beginning (order 0), shift others
        tagCategories = [
          { id: "goals", name: "Goals", order: 0 },
          ...tagCategories.map((c) => ({ ...c, order: c.order + 1 })),
        ];
        // Add example goal tags if they don't exist
        if (!tags.some((t) => t.categoryId === "goals")) {
          tags = [
            { id: "goal-launch", name: "Launch MVP", color: "#8B5CF6", categoryId: "goals" },
            { id: "goal-q1", name: "Q1 Planning", color: "#3B82F6", categoryId: "goals" },
            ...tags,
          ];
        }
      }

      // Ensure "custom" category exists
      if (!tagCategories.some((c) => c.id === "custom")) {
        tagCategories = [...tagCategories, { id: "custom", name: "Custom", order: tagCategories.length }];
      }
      // Ensure all cards have a swimlane (migrate existing cards to "work")
      // Also migrate legacy single 'link' field to 'links' array
      const cards = (parsed.cards ?? []).map((card) => {
        let migratedCard = {
          ...card,
          swimlane: card.swimlane ?? "work",
        };

        // Migrate legacy link to links array
        if (card.link && !card.links?.length) {
          const newLink: CardLink = {
            id: nanoid(),
            url: card.link,
          };
          migratedCard = {
            ...migratedCard,
            links: [newLink],
            link: undefined, // Clear legacy field
          };
        }

        return migratedCard;
      }) as Card[];
      // Migrate doing column: remove hard WIP limit of 1 (now soft warning at 3+)
      // Also migrate emoji icons to Lucide icon names
      const columns = (parsed.columns?.length ? parsed.columns : DEFAULT_COLUMNS).map((col) => {
        let updatedCol = col;
        if (col.id === "doing" && col.wipLimit === 1) {
          updatedCol = { ...updatedCol, wipLimit: null };
        }
        // Migrate emoji icon to Lucide icon name
        if (col.icon && EMOJI_TO_LUCIDE[col.icon]) {
          updatedCol = { ...updatedCol, icon: EMOJI_TO_LUCIDE[col.icon] };
        }
        return updatedCol;
      });
      return {
        cards,
        columns,
        templates: parsed.templates ?? [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
        },
        tagCategories,
        tags,
      };
    }

    // Only try old version migrations if NOT logged in (local-only mode)
    // Logged-in users should get fresh state, not other users' migrated data
    if (!currentUserId) {
      // Try v3 and migrate to v4
      const rawV3 = localStorage.getItem(KEY_V3);
      if (rawV3) {
        const parsed = JSON.parse(rawV3) as V3State;
        const v3State: V3State = {
          cards: parsed.cards ?? [],
          columns: parsed.columns?.length ? parsed.columns : DEFAULT_COLUMNS,
          templates: parsed.templates ?? [],
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings ?? {}),
          },
          tagCategories: parsed.tagCategories?.length ? parsed.tagCategories : DEFAULT_TAG_CATEGORIES,
          tags: parsed.tags?.length ? parsed.tags : DEFAULT_TAGS,
        };
        const migrated = migrateV3ToV4(v3State);
        saveState(migrated);
        return migrated;
      }

      // Try v2 and migrate through v3 to v4
      const rawV2 = localStorage.getItem(KEY_V2);
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as V2State;
        const v2State: V2State = {
          cards: parsed.cards ?? [],
          columns: parsed.columns?.length ? parsed.columns : DEFAULT_COLUMNS,
          templates: parsed.templates ?? [],
          settings: {
            ...DEFAULT_SETTINGS,
            ...(parsed.settings ?? {}),
          },
          tagCategories: parsed.tagCategories,
          tags: parsed.tags,
        };
        const v3State = migrateV2ToV3(v2State);
        const migrated = migrateV3ToV4(v3State);
        saveState(migrated);
        return migrated;
      }

      // Try v1 and migrate through v2, v3 to v4
      const rawV1 = localStorage.getItem(KEY_V1);
      if (rawV1) {
        const parsed = JSON.parse(rawV1) as V1State;
        const v2State = migrateV1ToV2(parsed);
        const v3State = migrateV2ToV3(v2State);
        const migrated = migrateV3ToV4(v3State);
        saveState(migrated);
        return migrated;
      }
    }

    // Fresh start (new user or no data)
    return getDefaultState();
  } catch {
    return getDefaultState();
  }
}

export function saveState(state: AppState) {
  // Save to user-scoped key (or global if not logged in)
  const scopedKey = getStorageKey(KEY_V4);
  localStorage.setItem(scopedKey, JSON.stringify(state));
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let queuedState: AppState | null = null;
const LOCAL_SAVE_DEBOUNCE_MS = 250;

export function debouncedSaveState(state: AppState): void {
  queuedState = state;
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    if (queuedState) {
      saveState(queuedState);
      queuedState = null;
    }
    saveTimeout = null;
  }, LOCAL_SAVE_DEBOUNCE_MS);
}

export function flushSaveState(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (queuedState) {
    saveState(queuedState);
    queuedState = null;
  }
}

const KEY_ONBOARDING = "focusboard:onboarding_seen";

export function hasSeenOnboarding(): boolean {
  // Check user-scoped key first, then global
  const scopedKey = getStorageKey(KEY_ONBOARDING);
  return localStorage.getItem(scopedKey) === "true" ||
         localStorage.getItem(KEY_ONBOARDING) === "true";
}

export function markOnboardingSeen(): void {
  // Save to user-scoped key
  const scopedKey = getStorageKey(KEY_ONBOARDING);
  localStorage.setItem(scopedKey, "true");
}

// Clear user-scoped storage on logout
export function clearUserStorage(): void {
  if (!currentUserId) return;

  const userSuffix = `:${currentUserId}`;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.includes(userSuffix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
