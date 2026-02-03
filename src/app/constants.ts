import {
  Archive,
  Palette,
  ListTodo,
  Zap,
  Ban,
  CheckCircle,
  Lightbulb,
  Rocket,
  Target,
  Package,
  Brain,
  Flame,
  type LucideIcon,
} from "lucide-react";
import type { SwimlaneId } from "./types";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  DEFAULT_SWIMLANES,
  DEFAULT_TAG_CATEGORIES,
  DEFAULT_TAGS,
} from "./defaults";

/**
 * Icon name to Lucide component mapping.
 * Used by Column and SettingsPanel for column icons.
 */
export const ICON_MAP: Record<string, LucideIcon> = {
  archive: Archive,
  palette: Palette,
  "list-todo": ListTodo,
  zap: Zap,
  ban: Ban,
  "check-circle": CheckCircle,
  lightbulb: Lightbulb,
  rocket: Rocket,
  target: Target,
  package: Package,
  brain: Brain,
  flame: Flame,
};

export type Swimlane = {
  id: SwimlaneId;
  title: string;
  icon: string;
  color: string;
};

export { DEFAULT_SWIMLANES, DEFAULT_COLUMNS, DEFAULT_SETTINGS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS };

// Re-exported defaults are defined in src/app/defaults.ts

export const COLUMN_COLORS: Record<string, string> = {
  backlog: "#64748b",
  design: "#8b5cf6",
  todo: "#0d9488",  // Teal
  doing: "#f59e0b",
  blocked: "#ef4444",
  done: "#10b981",
};

// DEFAULT_SETTINGS re-exported from defaults

export const CONFETTI_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#a78bfa"];

// Lucide icon names for column picker
export const DEFAULT_COLUMN_ICONS = ["archive", "palette", "list-todo", "zap", "ban", "check-circle", "brain", "flame", "lightbulb", "target", "package", "rocket"];

// DEFAULT_TAG_CATEGORIES and DEFAULT_TAGS re-exported from defaults

export const TAG_COLOR_PALETTE = [
  "#EF4444", "#F59E0B", "#10B981", "#06B6D4", "#3B82F6",
  "#8B5CF6", "#EC4899", "#6B7280", "#DC2626", "#7C3AED",
];
