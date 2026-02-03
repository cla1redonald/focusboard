import React from "react";
import { X, Sparkles, Loader2, Play, XCircle } from "lucide-react";
import type { Card, Column } from "../app/types";
import { useAI } from "../app/useAI";
import { getUrgencyLevel } from "../app/urgency";

type FocusSuggestion = {
  cardId: string;
  reason: string;
  priority: 1 | 2 | 3;
};

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  onClose: () => void;
  onStartTask: (cardId: string) => void;
  completedToday?: number;
  avgCycleTime?: number;
};

export function FocusSuggestionPanel({
  open,
  cards,
  columns,
  onClose,
  onStartTask,
  completedToday = 0,
  avgCycleTime,
}: Props) {
  const { getDailyFocus, isLoading } = useAI();
  const [suggestions, setSuggestions] = React.useState<FocusSuggestion[]>([]);
  const [insight, setInsight] = React.useState<string | undefined>();
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [hasLoaded, setHasLoaded] = React.useState(false);

  // Get the "doing" column's WIP limit
  const doingColumn = columns.find((c) => c.id === "doing");
  const wipLimit = doingColumn?.wipLimit ?? 3;

  // Load suggestions when panel opens
  React.useEffect(() => {
    if (!open || hasLoaded) return;

    const loadSuggestions = async () => {
      // Prepare cards for the API
      const cardData = cards.map((c) => ({
        id: c.id,
        title: c.title,
        column: c.column,
        dueDate: c.dueDate,
        tags: c.tags ?? [],
        urgencyLevel: getUrgencyLevel(c),
        createdAt: c.createdAt,
        blockedReason: c.blockedReason,
      }));

      const result = await getDailyFocus(cardData, {
        completedToday,
        avgCycleTime,
        wipLimit,
      });

      if (result) {
        setSuggestions(result.suggestions);
        setInsight(result.insight);
        setHasLoaded(true);
      }
    };

    void loadSuggestions();
  }, [open, hasLoaded, cards, getDailyFocus, completedToday, avgCycleTime, wipLimit]);

  // Reset when panel closes
  React.useEffect(() => {
    if (!open) {
      setHasLoaded(false);
      setSuggestions([]);
      setInsight(undefined);
      setDismissed(new Set());
    }
  }, [open]);

  if (!open) return null;

  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(s.cardId));

  const getUrgencyBadge = (card: Card) => {
    const level = getUrgencyLevel(card);
    switch (level) {
      case "critical":
        return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Overdue</span>;
      case "high":
        return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Due soon</span>;
      case "medium":
        return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">This week</span>;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[480px] max-w-[92vw] max-h-[85vh] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles className="text-emerald-500" size={20} />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Today's Focus</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={32} className="animate-spin text-emerald-500" />
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                Analyzing your tasks...
              </p>
            </div>
          ) : visibleSuggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 text-4xl">🎉</div>
              <p className="text-gray-600 dark:text-gray-400">
                {insight ?? "No tasks to focus on. Great job!"}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Based on your deadlines and workload, here's what to focus on:
              </p>

              <div className="space-y-3">
                {visibleSuggestions.map((suggestion, idx) => {
                  const card = cards.find((c) => c.id === suggestion.cardId);
                  if (!card) return null;

                  return (
                    <div
                      key={suggestion.cardId}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {card.icon && <span className="text-base">{card.icon}</span>}
                            <span className="font-medium text-gray-900 dark:text-white truncate">
                              {card.title}
                            </span>
                            {getUrgencyBadge(card)}
                          </div>
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {suggestion.reason}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => {
                            onStartTask(card.id);
                            setDismissed((prev) => new Set([...prev, card.id]));
                          }}
                          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          <Play size={14} />
                          Start Task
                        </button>
                        <button
                          onClick={() => setDismissed((prev) => new Set([...prev, card.id]))}
                          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                        >
                          <XCircle size={14} />
                          Not now
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {insight && (
                <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                  💡 {insight}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Completed today: {completedToday}</span>
            <button
              onClick={() => {
                setHasLoaded(false);
                setSuggestions([]);
                setDismissed(new Set());
              }}
              className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              Refresh suggestions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
