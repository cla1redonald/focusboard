import type { Column, Settings, SwimlaneId, Tag, TagCategory } from "./types";

export type Swimlane = {
  id: SwimlaneId;
  title: string;
  icon: string;
  color: string;
};

// Swimlane and column colours pull from the Roami Deep Tay palette so
// the board reads as a coherent visual system rather than a default-
// Tailwind rainbow. See public/tokens or src/index.css for source.
export const DEFAULT_SWIMLANES: Swimlane[] = [
  { id: "work", title: "Work", icon: "💼", color: "#2a5a5a" }, // river — work mode
  { id: "personal", title: "Personal", icon: "🏠", color: "#5a7247" }, // pine — personal/grounded
];

export const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", title: "Backlog", icon: "archive", color: "#a89880", wipLimit: null, isTerminal: false, order: 0 }, // sand
  { id: "design", title: "Design & Planning", icon: "palette", color: "#2a5a5a", wipLimit: 5, isTerminal: false, order: 1 }, // river
  { id: "todo", title: "To Do", icon: "list-todo", color: "#6b5d4f", wipLimit: 12, isTerminal: false, order: 2 }, // umber
  { id: "doing", title: "Doing", icon: "zap", color: "#c4956a", wipLimit: 3, isTerminal: false, order: 3 }, // copper — active focus
  { id: "blocked", title: "Blocked", icon: "ban", color: "#a04040", wipLimit: 5, isTerminal: false, order: 4 }, // muted error
  { id: "done", title: "Done", icon: "check-circle", color: "#5a7247", wipLimit: null, isTerminal: true, order: 5 }, // pine — growth
  { id: "wontdo", title: "Won't Do", icon: "x-circle", color: "#c4bdb2", wipLimit: null, isTerminal: true, order: 6 }, // neutral 300
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
  // Goals (examples — customize these!)
  { id: "goal-launch", name: "Launch MVP", color: "#c4956a", categoryId: "goals" }, // copper
  { id: "goal-q1", name: "Q1 Planning", color: "#2a5a5a", categoryId: "goals" }, // river
  // Priority — keep traffic-light semantics but warm the hues to fit Roami
  { id: "high", name: "High", color: "#a04040", categoryId: "priority" }, // muted red
  { id: "medium", name: "Medium", color: "#c4956a", categoryId: "priority" }, // copper
  { id: "low", name: "Low", color: "#5a7247", categoryId: "priority" }, // pine
  // Type
  { id: "bug", name: "Bug", color: "#a04040", categoryId: "type" },
  { id: "feature", name: "Feature", color: "#2a5a5a", categoryId: "type" },
  { id: "chore", name: "Chore", color: "#6b5d4f", categoryId: "type" }, // umber
  // Effort
  { id: "quick", name: "Quick win", color: "#5a7247", categoryId: "effort" },
  { id: "medium-effort", name: "Medium", color: "#c4956a", categoryId: "effort" },
  { id: "large", name: "Large", color: "#2a5a5a", categoryId: "effort" },
  // Feedback
  { id: "feedback-bug", name: "Bug Report", color: "#a04040", categoryId: "feedback" },
  { id: "feedback-feature", name: "Feature Request", color: "#c4956a", categoryId: "feedback" },
];
