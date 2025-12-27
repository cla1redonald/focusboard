import type { AppState, Column } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS } from "./constants";

const KEY_V1 = "focusboard:v1";
const KEY_V2 = "focusboard:v2";

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
  cards: Array<{ id: string; column: string; title: string; [key: string]: unknown }>;
  settings: Partial<V1Settings>;
};

function migrateV1ToV2(v1State: V1State): AppState {
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
  })) as AppState["cards"];

  return {
    cards,
    columns,
    settings: {
      celebrations: v1Settings.celebrations ?? DEFAULT_SETTINGS.celebrations,
      reducedMotionOverride: v1Settings.reducedMotionOverride ?? DEFAULT_SETTINGS.reducedMotionOverride,
      backgroundImage: v1Settings.backgroundImage ?? DEFAULT_SETTINGS.backgroundImage,
    },
  };
}

export function loadState(): AppState {
  try {
    // Try v2 first
    const rawV2 = localStorage.getItem(KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as AppState;
      return {
        cards: parsed.cards ?? [],
        columns: parsed.columns?.length ? parsed.columns : DEFAULT_COLUMNS,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
        },
      };
    }

    // Try v1 and migrate
    const rawV1 = localStorage.getItem(KEY_V1);
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as V1State;
      const migrated = migrateV1ToV2(parsed);

      // Save as v2 and optionally clean up v1
      saveState(migrated);

      return migrated;
    }

    // Fresh start
    return { cards: [], columns: DEFAULT_COLUMNS, settings: DEFAULT_SETTINGS };
  } catch {
    return { cards: [], columns: DEFAULT_COLUMNS, settings: DEFAULT_SETTINGS };
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY_V2, JSON.stringify(state));
}
