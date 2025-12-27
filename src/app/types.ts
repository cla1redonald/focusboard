export type ColumnId =
  | "backlog"
  | "design"
  | "todo"
  | "doing"
  | "blocked"
  | "done";

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

export type WipLimits = Partial<Record<ColumnId, number | null>>;

export type Settings = {
  celebrations: boolean;
  reducedMotionOverride: boolean; // if true, treat as reduced motion
  backgroundImage: string | null;
  columnColors: Record<ColumnId, string>;
  columnIcons: Record<ColumnId, string>;
  wip: {
    design: number;
    todo: number;
    doing: number;   // keep at 1 by default
    blocked: number;
  };
};

export type AppState = {
  cards: Card[];
  settings: Settings;
};
