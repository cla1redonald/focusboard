import type { Column, Settings, Tag, TagCategory } from "./types";

export const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", title: "Backlog", icon: "🗂️", color: "#F59E0B", wipLimit: null, isTerminal: false, order: 0 },
  { id: "design", title: "Design & Planning", icon: "🎨", color: "#FBBF24", wipLimit: 5, isTerminal: false, order: 1 },
  { id: "todo", title: "To Do", icon: "📝", color: "#FCD34D", wipLimit: 12, isTerminal: false, order: 2 },
  { id: "doing", title: "Doing", icon: "⚡", color: "#FB923C", wipLimit: 1, isTerminal: false, order: 3 },
  { id: "blocked", title: "Blocked", icon: "⛔", color: "#F87171", wipLimit: 5, isTerminal: false, order: 4 },
  { id: "done", title: "Done", icon: "✅", color: "#34D399", wipLimit: null, isTerminal: true, order: 5 },
];

export const MOO_COLUMN_COLORS: Record<string, string> = {
  backlog: "#F59E0B",
  design: "#FBBF24",
  todo: "#FCD34D",
  doing: "#FB923C",
  blocked: "#F87171",
  done: "#34D399",
};

export const DEFAULT_SETTINGS: Settings = {
  celebrations: true,
  reducedMotionOverride: false,
  backgroundImage: null,
  showAgingIndicators: true,
  staleCardThreshold: 7,
};

export const CONFETTI_COLORS = ["#FBBF24", "#FB923C", "#F59E0B", "#FCD34D", "#34D399"];

export const DEFAULT_COLUMN_ICONS = ["🗂️", "🎨", "📝", "⚡", "⛔", "✅", "🧠", "🔥", "💡", "🎯", "📦", "🚀"];

export const DEFAULT_TAG_CATEGORIES: TagCategory[] = [
  { id: "priority", name: "Priority", order: 0 },
  { id: "type", name: "Type", order: 1 },
  { id: "effort", name: "Effort", order: 2 },
  { id: "custom", name: "Custom", order: 3 },
];

export const DEFAULT_TAGS: Tag[] = [
  // Priority
  { id: "high", name: "High", color: "#EF4444", categoryId: "priority" },
  { id: "medium", name: "Medium", color: "#F59E0B", categoryId: "priority" },
  { id: "low", name: "Low", color: "#10B981", categoryId: "priority" },
  // Type
  { id: "bug", name: "Bug", color: "#DC2626", categoryId: "type" },
  { id: "feature", name: "Feature", color: "#8B5CF6", categoryId: "type" },
  { id: "chore", name: "Chore", color: "#6B7280", categoryId: "type" },
  // Effort
  { id: "quick", name: "Quick win", color: "#06B6D4", categoryId: "effort" },
  { id: "medium-effort", name: "Medium", color: "#3B82F6", categoryId: "effort" },
  { id: "large", name: "Large", color: "#7C3AED", categoryId: "effort" },
];

export const TAG_COLOR_PALETTE = [
  "#EF4444", "#F59E0B", "#10B981", "#06B6D4", "#3B82F6",
  "#8B5CF6", "#EC4899", "#6B7280", "#DC2626", "#7C3AED",
];
