import React from "react";
import type { Tag, Column } from "./types";

type ParsedCard = {
  title: string;
  column?: string;
  tags?: string[];
  dueDate?: string;
  swimlane?: "work" | "personal";
  notes?: string;
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
        const response = await fetch("/api/ai/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        setError(err instanceof Error ? err.message : "Unknown error");
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
        const response = await fetch("/api/ai/parse-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [availableColumns, availableTags]
  );

  return {
    suggestTags,
    parseCard,
    isLoading,
    error,
  };
}
