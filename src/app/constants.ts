import type { Column, Settings, SwimlaneId, Tag, TagCategory } from "./types";

export type Swimlane = {
  id: SwimlaneId;
  title: string;
  icon: string;
  color: string;
};

export const DEFAULT_SWIMLANES: Swimlane[] = [
  { id: "work", title: "Work", icon: "💼", color: "#3B82F6" },
  { id: "personal", title: "Personal", icon: "🏠", color: "#10B981" },
];

export const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", title: "Backlog", icon: "🗂️", color: "#64748b", wipLimit: null, isTerminal: false, order: 0 },
  { id: "design", title: "Design & Planning", icon: "🎨", color: "#8b5cf6", wipLimit: 5, isTerminal: false, order: 1 },
  { id: "todo", title: "To Do", icon: "📝", color: "#3b82f6", wipLimit: 12, isTerminal: false, order: 2 },
  { id: "doing", title: "Doing", icon: "⚡", color: "#f59e0b", wipLimit: null, isTerminal: false, order: 3 },
  { id: "blocked", title: "Blocked", icon: "⛔", color: "#ef4444", wipLimit: 5, isTerminal: false, order: 4 },
  { id: "done", title: "Done", icon: "✅", color: "#10b981", wipLimit: null, isTerminal: true, order: 5 },
];

export const COLUMN_COLORS: Record<string, string> = {
  backlog: "#64748b",
  design: "#8b5cf6",
  todo: "#3b82f6",
  doing: "#f59e0b",
  blocked: "#ef4444",
  done: "#10b981",
};

export const DEFAULT_SETTINGS: Settings = {
  celebrations: true,
  reducedMotionOverride: false,
  backgroundImage: null,
  showAgingIndicators: true,
  staleCardThreshold: 7,
  autoPriorityFromDueDate: false,
  staleBacklogThreshold: 7,
  collapsedSwimlanes: [],
};

export const CONFETTI_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#a78bfa"];

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
