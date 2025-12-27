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

  blockedReason?: string;
  lastOverrideReason?: string;
  lastOverrideAt?: string;
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
