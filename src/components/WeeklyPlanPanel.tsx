import React from "react";
import { X, CalendarDays, Loader2, ChevronLeft, ChevronRight, Check, AlertTriangle } from "lucide-react";
import type { Card, Column } from "../app/types";
import { useAI } from "../app/useAI";

type PlanSuggestion = {
  cardId: string;
  suggestedDate: string;
  reason: string;
};

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  onClose: () => void;
  onSetDueDate: (cardId: string, dueDate: string) => void;
  avgThroughput?: number;
};

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDayLabel(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

export function WeeklyPlanPanel({
  open,
  cards,
  columns: _columns,
  onClose,
  onSetDueDate,
  avgThroughput = 5,
}: Props) {
  void _columns; // Reserved for future column-based filtering
  const { getWeeklyPlan, isLoading } = useAI();
  const [weekStart, setWeekStart] = React.useState(() => getMonday(new Date()));
  const [suggestions, setSuggestions] = React.useState<PlanSuggestion[]>([]);
  const [weeklyGoal, setWeeklyGoal] = React.useState<string | undefined>();
  const [capacityWarning, setCapacityWarning] = React.useState<string | undefined>();
  const [appliedSuggestions, setAppliedSuggestions] = React.useState<Set<string>>(new Set());
  const [hasLoaded, setHasLoaded] = React.useState(false);

  // Calculate week days
  const weekDays = React.useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  // Get cards by date
  const cardsByDate = React.useMemo(() => {
    const map: Record<string, Card[]> = {};
    for (const day of weekDays) {
      map[formatDate(day)] = [];
    }
    for (const card of cards) {
      if (card.dueDate && map[card.dueDate]) {
        map[card.dueDate].push(card);
      }
    }
    return map;
  }, [cards, weekDays]);

  // Get unscheduled cards
  const unscheduledCards = React.useMemo(() => {
    return cards.filter(
      (c) => !c.dueDate && c.column !== "blocked" && c.column !== "done"
    );
  }, [cards]);

  // Load suggestions when panel opens
  React.useEffect(() => {
    if (!open || hasLoaded) return;

    const loadSuggestions = async () => {
      const cardData = cards.map((c) => ({
        id: c.id,
        title: c.title,
        column: c.column,
        dueDate: c.dueDate,
        tags: c.tags ?? [],
        swimlane: c.swimlane ?? "work",
      }));

      const result = await getWeeklyPlan(cardData, {
        weekStart: formatDate(weekStart),
        avgThroughput,
      });

      if (result) {
        setSuggestions(result.suggestions);
        setWeeklyGoal(result.weeklyGoal);
        setCapacityWarning(result.capacityWarning);
        setHasLoaded(true);
      }
    };

    loadSuggestions();
  }, [open, hasLoaded, cards, getWeeklyPlan, weekStart, avgThroughput]);

  // Reset when panel closes or week changes
  React.useEffect(() => {
    if (!open) {
      setHasLoaded(false);
      setSuggestions([]);
      setWeeklyGoal(undefined);
      setCapacityWarning(undefined);
      setAppliedSuggestions(new Set());
    }
  }, [open]);

  const handlePrevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
    setHasLoaded(false);
  };

  const handleNextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
    setHasLoaded(false);
  };

  const handleApplySuggestion = (suggestion: PlanSuggestion) => {
    onSetDueDate(suggestion.cardId, suggestion.suggestedDate);
    setAppliedSuggestions((prev) => new Set([...prev, suggestion.cardId]));
  };

  const handleApplyAll = () => {
    for (const suggestion of suggestions) {
      if (!appliedSuggestions.has(suggestion.cardId)) {
        onSetDueDate(suggestion.cardId, suggestion.suggestedDate);
      }
    }
    setAppliedSuggestions(new Set(suggestions.map((s) => s.cardId)));
  };

  const handleAssignToDay = (cardId: string, date: string) => {
    onSetDueDate(cardId, date);
  };

  if (!open) return null;

  const pendingSuggestions = suggestions.filter((s) => !appliedSuggestions.has(s.cardId));

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[800px] max-w-[95vw] max-h-[90vh] flex flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="text-emerald-500" size={20} />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Plan Your Week</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevWeek}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {formatDate(weekDays[0])} - {formatDate(weekDays[6])}
              </span>
              <button
                onClick={handleNextWeek}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              >
                <ChevronRight size={20} />
              </button>
            </div>
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
                Planning your week...
              </p>
            </div>
          ) : (
            <>
              {/* Weekly Goal */}
              {weeklyGoal && (
                <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                  🎯 {weeklyGoal}
                </div>
              )}

              {/* Capacity Warning */}
              {capacityWarning && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                  <AlertTriangle size={16} />
                  {capacityWarning}
                </div>
              )}

              {/* Calendar Grid */}
              <div className="mb-6 grid grid-cols-7 gap-2">
                {weekDays.map((day) => {
                  const dateStr = formatDate(day);
                  const dayCards = cardsByDate[dateStr] || [];
                  const isToday = dateStr === formatDate(new Date());
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                  return (
                    <div
                      key={dateStr}
                      className={`rounded-lg border p-2 min-h-[120px] ${
                        isToday
                          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20"
                          : isWeekend
                          ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
                          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                      }`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const cardId = e.dataTransfer.getData("cardId");
                        if (cardId) {
                          handleAssignToDay(cardId, dateStr);
                        }
                      }}
                    >
                      <div className={`text-xs font-medium mb-2 ${
                        isToday ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"
                      }`}>
                        {formatDayLabel(day)}
                      </div>
                      <div className="space-y-1">
                        {dayCards.slice(0, 3).map((card) => (
                          <div
                            key={card.id}
                            className="truncate text-xs text-gray-700 dark:text-gray-300 rounded bg-white dark:bg-gray-700 px-1.5 py-1 border border-gray-100 dark:border-gray-600"
                            title={card.title}
                          >
                            {card.icon && <span className="mr-1">{card.icon}</span>}
                            {card.title}
                          </div>
                        ))}
                        {dayCards.length > 3 && (
                          <div className="text-xs text-gray-400">
                            +{dayCards.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unscheduled Tasks */}
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Unscheduled Tasks (drag to assign)
                </h3>
                <div className="flex flex-wrap gap-2">
                  {unscheduledCards.length === 0 ? (
                    <p className="text-sm text-gray-400">All tasks are scheduled!</p>
                  ) : (
                    unscheduledCards.slice(0, 10).map((card) => (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("cardId", card.id)}
                        className="cursor-grab rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {card.icon && <span className="mr-1">{card.icon}</span>}
                        {card.title}
                      </div>
                    ))
                  )}
                  {unscheduledCards.length > 10 && (
                    <span className="text-sm text-gray-400 self-center">
                      +{unscheduledCards.length - 10} more
                    </span>
                  )}
                </div>
              </div>

              {/* AI Suggestions */}
              {pendingSuggestions.length > 0 && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      ✨ AI Suggestions
                    </h3>
                    <button
                      onClick={handleApplyAll}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      <Check size={14} />
                      Apply All
                    </button>
                  </div>
                  <div className="space-y-2">
                    {pendingSuggestions.map((suggestion) => {
                      const card = cards.find((c) => c.id === suggestion.cardId);
                      if (!card) return null;

                      return (
                        <div
                          key={suggestion.cardId}
                          className="flex items-center justify-between rounded-lg bg-white p-2 dark:bg-gray-800"
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {card.icon && <span className="mr-1">{card.icon}</span>}
                              {card.title}
                            </span>
                            <span className="mx-2 text-gray-400">→</span>
                            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                              {suggestion.suggestedDate}
                            </span>
                            <span className="ml-2 text-xs text-gray-400">
                              ({suggestion.reason})
                            </span>
                          </div>
                          <button
                            onClick={() => handleApplySuggestion(suggestion)}
                            className="ml-2 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:bg-gray-700 dark:text-emerald-400 dark:hover:bg-gray-600"
                          >
                            Apply
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{unscheduledCards.length} unscheduled tasks</span>
            <button
              onClick={() => {
                setHasLoaded(false);
                setSuggestions([]);
                setAppliedSuggestions(new Set());
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
