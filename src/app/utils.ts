import type { Card, Column, ColumnId, SwimlaneId } from "./types";

export const nowIso = () => new Date().toISOString();

/**
 * Sort comparator for cards: due date first (earliest first), then by order.
 * Cards with due dates come before cards without.
 */
export function compareCardsByDueDate(a: Card, b: Card): number {
  const aDue = a.dueDate ? new Date(a.dueDate).getTime() : null;
  const bDue = b.dueDate ? new Date(b.dueDate).getTime() : null;

  if (aDue !== null && bDue !== null) {
    if (aDue !== bDue) return aDue - bDue;
  } else if (aDue !== null) {
    return -1;
  } else if (bDue !== null) {
    return 1;
  }
  return (a.order ?? 0) - (b.order ?? 0);
}

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

  // Sort cards within each column
  for (const colId of Object.keys(map)) {
    map[colId].sort(compareCardsByDueDate);
  }

  return map;
}

export function groupBySwimlaneAndColumn(
  cards: Card[],
  columns?: Column[]
): Record<SwimlaneId, Record<ColumnId, Card[]>> {
  const result: Record<SwimlaneId, Record<ColumnId, Card[]>> = {
    work: {},
    personal: {},
  };

  // Initialize with empty arrays for all columns in each swimlane
  if (columns) {
    for (const swimlane of ["work", "personal"] as SwimlaneId[]) {
      for (const col of columns) {
        result[swimlane][col.id] = [];
      }
    }
  }

  // Group cards by swimlane and column
  for (const card of cards) {
    const swimlane: SwimlaneId = card.swimlane ?? "work";
    if (!result[swimlane][card.column]) {
      result[swimlane][card.column] = [];
    }
    result[swimlane][card.column].push(card);
  }

  // Sort cards within each column
  for (const swimlane of Object.keys(result) as SwimlaneId[]) {
    for (const colId of Object.keys(result[swimlane])) {
      result[swimlane][colId].sort(compareCardsByDueDate);
    }
  }

  return result;
}

/**
 * Suggest an emoji based on keywords in the card title
 * Returns the first matching emoji or undefined
 */
export function suggestEmojiForTitle(title: string): string | undefined {
  const lower = title.toLowerCase();

  const keywordMap: Array<{ keywords: string[]; emoji: string }> = [
    // Actions & Tasks
    { keywords: ["meeting", "meet", "call", "sync"], emoji: "📞" },
    { keywords: ["email", "mail", "send", "reply"], emoji: "📧" },
    { keywords: ["write", "writing", "draft", "document", "doc"], emoji: "📝" },
    { keywords: ["review", "feedback", "approve"], emoji: "👀" },
    { keywords: ["fix", "bug", "debug", "issue", "error"], emoji: "🐛" },
    { keywords: ["test", "testing", "qa"], emoji: "🧪" },
    { keywords: ["deploy", "release", "ship", "launch"], emoji: "🚀" },
    { keywords: ["research", "investigate", "explore", "learn"], emoji: "🔍" },
    { keywords: ["design", "mockup", "wireframe", "ui", "ux"], emoji: "🎨" },
    { keywords: ["plan", "planning", "strategy", "roadmap"], emoji: "🗺️" },
    { keywords: ["build", "create", "develop", "implement"], emoji: "🔨" },
    { keywords: ["refactor", "clean", "cleanup", "organize"], emoji: "🧹" },
    { keywords: ["update", "upgrade", "migrate"], emoji: "⬆️" },

    // Work topics
    { keywords: ["api", "endpoint", "backend"], emoji: "⚡" },
    { keywords: ["database", "db", "sql", "data"], emoji: "🗄️" },
    { keywords: ["auth", "login", "security", "password"], emoji: "🔐" },
    { keywords: ["payment", "billing", "invoice", "price"], emoji: "💳" },
    { keywords: ["report", "analytics", "metrics", "stats"], emoji: "📊" },
    { keywords: ["user", "users", "customer", "client"], emoji: "👤" },
    { keywords: ["team", "hiring", "interview", "onboard"], emoji: "👥" },
    { keywords: ["budget", "finance", "money", "cost"], emoji: "💰" },
    { keywords: ["content", "blog", "article", "post"], emoji: "✍️" },
    { keywords: ["marketing", "campaign", "ads", "promo"], emoji: "📢" },
    { keywords: ["support", "help", "ticket"], emoji: "🎫" },

    // Personal
    { keywords: ["gym", "workout", "exercise", "fitness", "run"], emoji: "🏃" },
    { keywords: ["grocery", "groceries", "shopping", "buy"], emoji: "🛒" },
    { keywords: ["cook", "cooking", "recipe", "meal", "dinner", "lunch"], emoji: "🍳" },
    { keywords: ["clean", "cleaning", "laundry", "house"], emoji: "🧽" },
    { keywords: ["doctor", "dentist", "appointment", "health"], emoji: "🏥" },
    { keywords: ["travel", "trip", "vacation", "flight", "hotel"], emoji: "✈️" },
    { keywords: ["birthday", "party", "celebrate", "gift"], emoji: "🎉" },
    { keywords: ["book", "read", "reading"], emoji: "📚" },
    { keywords: ["movie", "film", "watch", "netflix", "show"], emoji: "🎬" },
    { keywords: ["music", "playlist", "concert", "song"], emoji: "🎵" },
    { keywords: ["phone", "mobile", "app"], emoji: "📱" },
    { keywords: ["car", "vehicle", "drive", "mechanic"], emoji: "🚗" },
    { keywords: ["pet", "dog", "cat", "vet"], emoji: "🐕" },
    { keywords: ["family", "kids", "parent"], emoji: "👨‍👩‍👧" },

    // Priority/Urgency
    { keywords: ["urgent", "asap", "critical", "important"], emoji: "🔥" },
    { keywords: ["idea", "brainstorm", "think"], emoji: "💡" },
    { keywords: ["question", "ask", "clarify"], emoji: "❓" },
    { keywords: ["reminder", "remember", "dont forget"], emoji: "🔔" },
  ];

  for (const { keywords, emoji } of keywordMap) {
    for (const keyword of keywords) {
      // Match whole words to avoid false positives
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(lower)) {
        return emoji;
      }
    }
  }

  return undefined;
}

/**
 * Suggest tags based on keywords in the card title
 * Returns an array of tag IDs that match
 */
/**
 * Check if a URL is safe to use in href attributes
 * Prevents javascript: and other dangerous protocols
 */
export function isSafeUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    // If URL parsing fails, check if it's a relative URL (starts with /)
    return url.startsWith("/") && !url.startsWith("//");
  }
}

/**
 * Sanitize a URL for safe use - returns the URL if safe, undefined otherwise
 */
export function getSafeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return isSafeUrl(url) ? url : undefined;
}

export function suggestTagsForTitle(title: string, availableTagIds: string[]): string[] {
  const lower = title.toLowerCase();
  const suggested: string[] = [];

  // Map keywords to default tag IDs
  const tagKeywords: Record<string, string[]> = {
    "bug": ["bug", "fix", "broken", "error", "crash", "issue"],
    "feature": ["feature", "add", "new", "implement", "create"],
    "chore": ["chore", "cleanup", "refactor", "update", "upgrade", "maintenance"],
    "high": ["urgent", "asap", "critical", "important", "priority"],
    "quick": ["quick", "easy", "simple", "small", "minor"],
    "large": ["large", "big", "complex", "major", "epic"],
  };

  for (const [tagId, keywords] of Object.entries(tagKeywords)) {
    if (!availableTagIds.includes(tagId)) continue;

    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(lower)) {
        suggested.push(tagId);
        break;
      }
    }
  }

  return suggested;
}
