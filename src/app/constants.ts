import type { Column, Settings } from "./types";

export const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", title: "Backlog", icon: "🗂️", color: "#86B6B0", wipLimit: null, isTerminal: false, order: 0 },
  { id: "design", title: "Design & Planning", icon: "🎨", color: "#9EC6AD", wipLimit: 5, isTerminal: false, order: 1 },
  { id: "todo", title: "To Do", icon: "📝", color: "#B6D6C1", wipLimit: 12, isTerminal: false, order: 2 },
  { id: "doing", title: "Doing", icon: "⚡", color: "#7ABFA6", wipLimit: 1, isTerminal: false, order: 3 },
  { id: "blocked", title: "Blocked", icon: "⛔", color: "#A6C2C7", wipLimit: 5, isTerminal: false, order: 4 },
  { id: "done", title: "Done", icon: "✅", color: "#6FBAC8", wipLimit: null, isTerminal: true, order: 5 },
];

export const MOO_COLUMN_COLORS: Record<string, string> = {
  backlog: "#86B6B0",
  design: "#9EC6AD",
  todo: "#B6D6C1",
  doing: "#7ABFA6",
  blocked: "#A6C2C7",
  done: "#6FBAC8",
};

export const DEFAULT_SETTINGS: Settings = {
  celebrations: true,
  reducedMotionOverride: false,
  backgroundImage: null,
};

export const CONFETTI_COLORS = ["#7C5CFF", "#A89BFF", "#5E6170"];

export const DEFAULT_COLUMN_ICONS = ["🗂️", "🎨", "📝", "⚡", "⛔", "✅", "🧠", "🔥", "💡", "🎯", "📦", "🚀"];
