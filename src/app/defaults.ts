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
  { id: "backlog", title: "Backlog", icon: "archive", color: "#64748b", wipLimit: null, isTerminal: false, order: 0 },
  { id: "design", title: "Design & Planning", icon: "palette", color: "#8b5cf6", wipLimit: 5, isTerminal: false, order: 1 },
  { id: "todo", title: "To Do", icon: "list-todo", color: "#0d9488", wipLimit: 12, isTerminal: false, order: 2 },
  { id: "doing", title: "Doing", icon: "zap", color: "#f59e0b", wipLimit: 3, isTerminal: false, order: 3 },
  { id: "blocked", title: "Blocked", icon: "ban", color: "#ef4444", wipLimit: 5, isTerminal: false, order: 4 },
  { id: "done", title: "Done", icon: "check-circle", color: "#10b981", wipLimit: null, isTerminal: true, order: 5 },
  { id: "wontdo", title: "Won't Do", icon: "x-circle", color: "#94a3b8", wipLimit: null, isTerminal: true, order: 6 },
];

export const DEFAULT_SETTINGS: Settings = {
  celebrations: true,
  reducedMotionOverride: false,
  backgroundImage: null,
  showAgingIndicators: true,
  staleCardThreshold: 7,
  autoPriorityFromDueDate: false,
  staleBacklogThreshold: 7,
  collapsedSwimlanes: [],
  theme: "light",
  autoArchive: true,
};

export const DEFAULT_TAG_CATEGORIES: TagCategory[] = [
  { id: "goals", name: "Goals", order: 0 },
  { id: "priority", name: "Priority", order: 1 },
  { id: "type", name: "Type", order: 2 },
  { id: "effort", name: "Effort", order: 3 },
  { id: "feedback", name: "Feedback", order: 4 },
  { id: "custom", name: "Custom", order: 5 },
];

export const DEFAULT_TAGS: Tag[] = [
  // Goals (examples - customize these!)
  { id: "goal-launch", name: "Launch MVP", color: "#8B5CF6", categoryId: "goals" },
  { id: "goal-q1", name: "Q1 Planning", color: "#3B82F6", categoryId: "goals" },
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
  // Feedback (for user-submitted feedback)
  { id: "feedback-bug", name: "Bug Report", color: "#EF4444", categoryId: "feedback" },
  { id: "feedback-feature", name: "Feature Request", color: "#8B5CF6", categoryId: "feedback" },
];
