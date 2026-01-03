import React from "react";
import type { Tag, Column } from "./types";
import { supabase } from "./supabase";
import { logger } from "./logger";

// Default timeout for AI API requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Get the current session access token for API authentication
 */
async function getAuthToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Create headers with auth token
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAuthToken();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Fetch with timeout support
 * Wraps the native fetch with an AbortController to enforce a timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

type ParsedCard = {
  title: string;
  column?: string;
  tags?: string[];
  dueDate?: string;
  swimlane?: "work" | "personal";
  notes?: string;
};

type Subtask = {
  text: string;
  estimatedEffort?: "quick" | "medium" | "large";
};

type BreakdownResult = {
  subtasks: Subtask[];
  suggestion?: string;
};

type FocusSuggestion = {
  cardId: string;
  reason: string;
  priority: 1 | 2 | 3;
};

type DailyFocusResult = {
  suggestions: FocusSuggestion[];
  insight?: string;
};

type CardForFocus = {
  id: string;
  title: string;
  column: string;
  dueDate?: string;
  tags: string[];
  urgencyLevel: string;
  createdAt: string;
  blockedReason?: string;
};

type PlanSuggestion = {
  cardId: string;
  suggestedDate: string;
  reason: string;
};

type WeeklyPlanResult = {
  suggestions: PlanSuggestion[];
  weeklyGoal?: string;
  capacityWarning?: string;
};

type CardForPlan = {
  id: string;
  title: string;
  column: string;
  dueDate?: string;
  tags: string[];
  swimlane: string;
};

type UseAIOptions = {
  availableTags?: Tag[];
  availableColumns?: Column[];
};

export function useAI({ availableTags = [], availableColumns = [] }: UseAIOptions = {}) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const suggestTags = React.useCallback(
    async (title: string): Promise<string[]> => {
      if (!title.trim()) return [];

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithTimeout("/api/ai/suggest", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            title,
            availableTags: availableTags.map((t) => ({ id: t.id, name: t.name })),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to get suggestions");
        }

        const data = await response.json();

        // Map suggested tag names to IDs
        const suggestedIds: string[] = [];
        for (const tagName of data.suggestedTags || []) {
          const tag = availableTags.find(
            (t) => t.name.toLowerCase() === tagName.toLowerCase() || t.id === tagName
          );
          if (tag) {
            suggestedIds.push(tag.id);
          }
        }

        return suggestedIds;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to get tag suggestions", { action: "suggestTags" }, err);
        setError(message);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [availableTags]
  );

  const parseCard = React.useCallback(
    async (input: string): Promise<ParsedCard | null> => {
      if (!input.trim()) return null;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithTimeout("/api/ai/parse-card", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            input,
            availableColumns: availableColumns.map((c) => ({ id: c.id, title: c.title })),
            availableTags: availableTags.map((t) => ({ id: t.id, name: t.name })),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to parse card");
        }

        const data = await response.json();
        return data.card || null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to parse card with AI", { action: "parseCard" }, err);
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [availableColumns, availableTags]
  );

  const breakdownTask = React.useCallback(
    async (
      title: string,
      options?: { notes?: string; tags?: string[]; existingChecklist?: string[] }
    ): Promise<BreakdownResult | null> => {
      if (!title.trim()) return null;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithTimeout("/api/ai/breakdown", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            title,
            notes: options?.notes,
            tags: options?.tags,
            existingChecklist: options?.existingChecklist,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to break down task");
        }

        const data = await response.json();
        return {
          subtasks: data.subtasks || [],
          suggestion: data.suggestion,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to break down task", { action: "breakdownTask" }, err);
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getDailyFocus = React.useCallback(
    async (
      cards: CardForFocus[],
      options?: { completedToday?: number; avgCycleTime?: number; wipLimit?: number }
    ): Promise<DailyFocusResult | null> => {
      if (!cards.length) return { suggestions: [], insight: "No tasks available" };

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithTimeout("/api/ai/daily-focus", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            cards,
            completedToday: options?.completedToday ?? 0,
            avgCycleTime: options?.avgCycleTime,
            wipLimit: options?.wipLimit ?? 3,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to get daily focus");
        }

        const data = await response.json();
        return {
          suggestions: data.suggestions || [],
          insight: data.insight,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to get daily focus suggestions", { action: "getDailyFocus" }, err);
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getWeeklyPlan = React.useCallback(
    async (
      cards: CardForPlan[],
      options?: {
        weekStart?: string;
        avgThroughput?: number;
        existingCommitments?: Array<{ date: string; count: number }>;
      }
    ): Promise<WeeklyPlanResult | null> => {
      if (!cards.length) return { suggestions: [], weeklyGoal: "No tasks to plan" };

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchWithTimeout("/api/ai/weekly-plan", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            cards,
            weekStart: options?.weekStart,
            avgThroughput: options?.avgThroughput,
            existingCommitments: options?.existingCommitments,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to get weekly plan");
        }

        const data = await response.json();
        return {
          suggestions: data.suggestions || [],
          weeklyGoal: data.weeklyGoal,
          capacityWarning: data.capacityWarning,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to get weekly plan", { action: "getWeeklyPlan" }, err);
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    suggestTags,
    parseCard,
    breakdownTask,
    getDailyFocus,
    getWeeklyPlan,
    isLoading,
    error,
  };
}
