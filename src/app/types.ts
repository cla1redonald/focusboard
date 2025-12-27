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

export type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean; // if true, treat as reduced motion
  backgroundImage: string | null;
};

export type AppState = {
  cards: Card[];
  columns: Column[];
  settings: Settings;
};
