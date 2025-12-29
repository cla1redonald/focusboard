export type ColumnId = string;

export type SwimlaneId = "work" | "personal";

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

// Tag types
export type Tag = {
  id: string;
  name: string;
  color: string; // Hex color (e.g., "#EF4444")
  categoryId: string;
};

export type TagCategory = {
  id: string;
  name: string;
  order: number;
};

export type Card = {
  id: string;
  column: ColumnId;
  swimlane?: SwimlaneId; // "work" or "personal" - defaults to "work"
  title: string;
  order: number; // Position within column (lower = higher in list)
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

  backgroundImage?: string; // URL to background image (e.g., from Unsplash)
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
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate?: string;
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
  showAgingIndicators: boolean;
  staleCardThreshold: 3 | 7 | 14;
  autoPriorityFromDueDate: boolean; // Auto-assign priority tags based on due dates
  staleBacklogThreshold: 3 | 7 | 14; // Days before backlog cards without due dates show warning
  collapsedSwimlanes: SwimlaneId[]; // Which swimlanes are collapsed
};

// Analytics types
export type StaleCard = {
  card: Card;
  columnTitle: string;
  daysSinceUpdate: number;
};

export type ColumnAgeStats = {
  columnId: string;
  columnTitle: string;
  columnColor: string;
  cardCount: number;
  avgAgeMs: number;
  maxAgeMs: number;
  oldestCardTitle?: string;
};

export type CycleTimeBucket = {
  label: string;
  rangeLabel: string;
  count: number;
  percentage: number;
};

export type BlockedCardInfo = {
  card: Card;
  blockedSinceMs: number;
  blockedCount: number;
};

export type BlockedTimeStats = {
  avgBlockedTimeMs: number;
  currentlyBlocked: BlockedCardInfo[];
  frequentlyBlocked: Array<{
    cardId: string;
    title: string;
    blockCount: number;
  }>;
};

export type CFDDataPoint = {
  date: string;
  columns: Record<string, number>;
  cumulativeCounts: Record<string, number>;
};

export type CardAgeLevel = "none" | "yellow" | "orange" | "red";

// Urgency level based on due date proximity
export type UrgencyLevel = "none" | "low" | "medium" | "high" | "critical";

// Timeline card for Gantt view
export type TimelineCard = {
  card: Card;
  columnTitle: string;
  columnColor: string;
  startDate: Date;
  endDate: Date | null; // null if no due date
  urgencyLevel: UrgencyLevel;
};

export type AppState = {
  cards: Card[];
  columns: Column[];
  templates: CardTemplate[];
  settings: Settings;
  tagCategories: TagCategory[];
  tags: Tag[];
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
