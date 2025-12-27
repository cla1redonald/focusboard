import type { Card, ColumnId } from "./types";

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

export function groupByColumn(cards: Card[]) {
  const map: Record<ColumnId, Card[]> = {
    backlog: [],
    design: [],
    todo: [],
    doing: [],
    blocked: [],
    done: [],
  };
  for (const c of cards) map[c.column].push(c);
  return map;
}
