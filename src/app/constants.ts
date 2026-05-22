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

// Roami Deep Tay palette — keep in sync with src/app/defaults.ts.
export const COLUMN_COLORS: Record<string, string> = {
  backlog: "#a89880", // sand
  design: "#2a5a5a",  // river
  todo: "#6b5d4f",    // umber
  doing: "#c4956a",   // copper
  blocked: "#a04040", // muted red
  done: "#5a7247",    // pine
};

// DEFAULT_SETTINGS re-exported from defaults

// Confetti uses the warm Roami palette — copper, pine, river, sand, mist.
export const CONFETTI_COLORS = ["#c4956a", "#5a7247", "#2a5a5a", "#a89880", "#f0eee8"];

// Lucide icon names for column picker
export const DEFAULT_COLUMN_ICONS = ["archive", "palette", "list-todo", "zap", "ban", "check-circle", "brain", "flame", "lightbulb", "target", "package", "rocket"];

// DEFAULT_TAG_CATEGORIES and DEFAULT_TAGS re-exported from defaults

// Custom tag colour picker — Roami brand palette with a few semantic
// reds kept so users can still flag urgency/severity without picking
// custom values.
export const TAG_COLOR_PALETTE = [
  "#c4956a", // copper
  "#a87d55", // copper-dark
  "#5a7247", // pine
  "#2a5a5a", // river
  "#a89880", // sand
  "#6b5d4f", // umber
  "#a04040", // muted red
  "#6a8a8a", // sage
  "#4a3f35", // deep brown
  "#111a24", // ink
];
