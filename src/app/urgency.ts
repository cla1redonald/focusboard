import type { Card, UrgencyLevel } from "./types";

/**
 * Calculate urgency level based on due date proximity
 * - critical: overdue
 * - high: due within 3 days
 * - medium: due within 7 days
 * - low: due within 14 days
 * - none: no due date or due > 14 days
 */
export function getUrgencyLevel(card: Card): UrgencyLevel {
  if (!card.dueDate) return "none";

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(card.dueDate);
  dueDate.setHours(0, 0, 0, 0);

  const daysUntilDue = Math.ceil(
    (dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysUntilDue < 0) return "critical"; // Overdue
  if (daysUntilDue <= 3) return "high";
  if (daysUntilDue <= 7) return "medium";
  if (daysUntilDue <= 14) return "low";
  return "none";
}

/**
 * Get days until due date (negative if overdue)
 */
export function getDaysUntilDue(card: Card): number | null {
  if (!card.dueDate) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(card.dueDate);
  dueDate.setHours(0, 0, 0, 0);

  return Math.ceil(
    (dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );
}

/**
 * Get urgency color for visual indicators
 */
export function getUrgencyColor(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "#DC2626"; // Red
    case "high":
      return "#F97316"; // Orange
    case "medium":
      return "#F59E0B"; // Amber
    case "low":
      return "#3B82F6"; // Blue
    default:
      return "transparent";
  }
}

/**
 * Get urgency label for display
 */
export function getUrgencyLabel(level: UrgencyLevel): string {
  switch (level) {
    case "critical":
      return "Overdue";
    case "high":
      return "Due soon";
    case "medium":
      return "This week";
    case "low":
      return "Upcoming";
    default:
      return "";
  }
}

/**
 * Get priority tag ID that corresponds to urgency level
 */
export function getUrgencyPriorityTag(level: UrgencyLevel): string | null {
  switch (level) {
    case "critical":
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return null;
  }
}

/**
 * Check if a card should have auto-priority applied
 * Returns the tag ID to apply, or null if no change needed
 * Does NOT override existing priority tags
 */
export function calculateAutoPriority(
  card: Card,
  existingTags: string[]
): string | null {
  const urgency = getUrgencyLevel(card);
  const priorityTagId = getUrgencyPriorityTag(urgency);

  if (!priorityTagId) return null;

  // Check if already has a priority tag - don't override manual assignments
  const priorityTags = ["high", "medium", "low"];
  const hasPriorityTag = existingTags.some((t) => priorityTags.includes(t));

  if (hasPriorityTag) return null;

  return priorityTagId;
}

/**
 * Check if a backlog card is stale (no due date and not updated recently)
 */
export function isStaleBacklogCard(
  card: Card,
  columnId: string,
  thresholdDays: number
): boolean {
  // Must be in backlog column
  if (columnId !== "backlog") return false;

  // If card has a due date, it's not considered stale (they're being proactive)
  if (card.dueDate) return false;

  const now = Date.now();
  const lastUpdate = new Date(card.updatedAt).getTime();
  const daysSinceUpdate = (now - lastUpdate) / (24 * 60 * 60 * 1000);

  return daysSinceUpdate >= thresholdDays;
}

/**
 * Get number of days a backlog card has been stale
 */
export function getStaleBacklogDays(card: Card): number {
  const now = Date.now();
  const lastUpdate = new Date(card.updatedAt).getTime();
  return Math.floor((now - lastUpdate) / (24 * 60 * 60 * 1000));
}
