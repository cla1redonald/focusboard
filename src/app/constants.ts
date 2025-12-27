import type { ColumnId, Settings } from "./types";

export const COLUMNS: { id: ColumnId; title: string; capped: boolean }[] = [
  { id: "backlog", title: "Backlog", capped: false },
  { id: "design", title: "Design & Planning", capped: true },
  { id: "todo", title: "To Do", capped: true },
  { id: "doing", title: "Doing", capped: true },
  { id: "blocked", title: "Blocked", capped: true },
  { id: "done", title: "Done", capped: false },
];

export const DEFAULT_SETTINGS: Settings = {
  celebrations: true,
  reducedMotionOverride: false,
  backgroundImage: null,
  columnColors: {
    backlog: "#3b82f6",
    design: "#8b5cf6",
    todo: "#f97316",
    doing: "#22c55e",
    blocked: "#ef4444",
    done: "#06b6d4",
  },
  columnIcons: {
    backlog: "🗂️",
    design: "🎨",
    todo: "📝",
    doing: "⚡",
    blocked: "⛔",
    done: "✅",
  },
  wip: {
    design: 5,
    todo: 12,
    doing: 1,
    blocked: 5,
  },
};

export const CONFETTI_COLORS = ["#7C5CFF", "#A89BFF", "#5E6170"];
