export type ColumnId = string;

export type Column = {
  id: ColumnId;
  title: string;
  icon: string;
  color: string;
  wipLimit: number | null; // null means unlimited
  isTerminal: boolean; // marks completion columns (like Done)
  order: number;
};

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type ColumnTransition = {
  from: ColumnId | null; // null for initial creation
  to: ColumnId;
  at: string; // ISO date
};

export type RelationType = "blocks" | "blocked-by" | "parent" | "child" | "related";

export type CardRelation = {
  id: string;
  type: RelationType;
  targetCardId: string;
};

export type Card = {
  id: string;
  column: ColumnId;
  title: string;
  icon?: string;
  notes?: string;
  link?: string;
  dueDate?: string; // ISO date
  tags?: string[];
  checklist?: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string; // ISO date when moved to terminal column

  blockedReason?: string;
  lastOverrideReason?: string;
  lastOverrideAt?: string;

  columnHistory?: ColumnTransition[]; // Track all column movements
  relations?: CardRelation[]; // Links to other cards
};

// Metrics types
export type CompletedCardMetric = {
  cardId: string;
  title: string;
  createdAt: string;
  completedAt: string;
  leadTimeMs: number; // creation to completion
  cycleTimeMs: number; // first active work to completion
  firstActiveAt?: string; // when card first entered a non-backlog column
};

export type DailySnapshot = {
  date: string; // ISO date (YYYY-MM-DD)
  columnCounts: Record<ColumnId, number>;
  completedCount: number;
  wipViolations: number;
};

export type MetricsState = {
  completedCards: CompletedCardMetric[];
  dailySnapshots: DailySnapshot[];
  wipViolations: number;
  lastSnapshotDate?: string;
};

export type CardTemplate = {
  id: string;
  name: string;
  icon?: string;
  defaultColumn: ColumnId;
  title: string;
  notes?: string;
  tags?: string[];
  checklist?: { text: string; done: boolean }[];
};

export type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean; // if true, treat as reduced motion
  backgroundImage: string | null;
};

export type AppState = {
  cards: Card[];
  columns: Column[];
  templates: CardTemplate[];
  settings: Settings;
};

// Filter types
export type DueDateFilter = "all" | "overdue" | "today" | "this-week" | "no-date";

export type FilterState = {
  search: string;
  columns: ColumnId[]; // empty = all columns
  tags: string[]; // empty = all tags
  dueDate: DueDateFilter;
  hasBlocker: boolean | null; // null = any, true = only blocked, false = only unblocked
};
