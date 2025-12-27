import type { Card, Column, ColumnId } from "./types";

export const nowIso = () => new Date().toISOString();

export function isToday(isoDate?: string) {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
}

export function groupByColumn(cards: Card[], columns?: Column[]): Record<ColumnId, Card[]> {
  const map: Record<ColumnId, Card[]> = {};

  // Initialize map with empty arrays for all columns
  if (columns) {
    for (const col of columns) {
      map[col.id] = [];
    }
  }

  // Group cards into their columns
  for (const c of cards) {
    if (!map[c.column]) {
      map[c.column] = [];
    }
    map[c.column].push(c);
  }

  return map;
}
