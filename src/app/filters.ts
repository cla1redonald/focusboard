import type { Card, FilterState, DueDateFilter } from "./types";

export const DEFAULT_FILTER: FilterState = {
  search: "",
  columns: [],
  tags: [],
  dueDate: "all",
  hasBlocker: null,
};

export function isFilterActive(filter: FilterState): boolean {
  return (
    filter.search !== "" ||
    filter.columns.length > 0 ||
    filter.tags.length > 0 ||
    filter.dueDate !== "all" ||
    filter.hasBlocker !== null
  );
}

function matchesSearch(card: Card, search: string): boolean {
  if (!search) return true;
  const lowerSearch = search.toLowerCase();

  // Search in title
  if (card.title.toLowerCase().includes(lowerSearch)) return true;

  // Search in notes
  if (card.notes?.toLowerCase().includes(lowerSearch)) return true;

  // Search in tags
  if (card.tags?.some(tag => tag.toLowerCase().includes(lowerSearch))) return true;

  // Search in checklist items
  if (card.checklist?.some(item => item.text.toLowerCase().includes(lowerSearch))) return true;

  return false;
}

function matchesColumns(card: Card, columns: string[]): boolean {
  if (columns.length === 0) return true;
  return columns.includes(card.column);
}

function matchesTags(card: Card, tags: string[]): boolean {
  if (tags.length === 0) return true;
  if (!card.tags || card.tags.length === 0) return false;
  return tags.some(tag => card.tags?.includes(tag));
}

function matchesDueDate(card: Card, dueDateFilter: DueDateFilter): boolean {
  if (dueDateFilter === "all") return true;

  if (dueDateFilter === "no-date") {
    return !card.dueDate;
  }

  if (!card.dueDate) return false;

  const dueDate = new Date(card.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  endOfWeek.setHours(23, 59, 59, 999);

  switch (dueDateFilter) {
    case "overdue":
      return dueDate < today;
    case "today":
      return dueDate >= today && dueDate < tomorrow;
    case "this-week":
      return dueDate >= today && dueDate <= endOfWeek;
    default:
      return true;
  }
}

function matchesBlocker(card: Card, hasBlocker: boolean | null): boolean {
  if (hasBlocker === null) return true;
  const isBlocked = !!card.blockedReason || card.column === "blocked";
  return hasBlocker === isBlocked;
}

export function filterCards(cards: Card[], filter: FilterState): Card[] {
  return cards.filter(card => {
    if (!matchesSearch(card, filter.search)) return false;
    if (!matchesColumns(card, filter.columns)) return false;
    if (!matchesTags(card, filter.tags)) return false;
    if (!matchesDueDate(card, filter.dueDate)) return false;
    if (!matchesBlocker(card, filter.hasBlocker)) return false;
    return true;
  });
}

export function getAllTags(cards: Card[]): string[] {
  const tagSet = new Set<string>();
  for (const card of cards) {
    if (card.tags) {
      for (const tag of card.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
}

export function getFilteredCount(cards: Card[], filter: FilterState): number {
  return filterCards(cards, filter).length;
}
