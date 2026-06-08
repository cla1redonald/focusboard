import React from "react";
import { ArrowRight, CheckCircle2, X, Repeat } from "lucide-react";
import type { Card, Column, MetricsState } from "../app/types";
import { buildWeeklyReviewSummary } from "../app/review";

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  metrics: MetricsState;
  onClose: () => void;
  onOpenCard: (card: Card) => void;
  onComplete: (week: string) => void;
};

function CardList({ cards, onOpenCard, empty }: { cards: Card[]; onOpenCard: (card: Card) => void; empty: string }) {
  if (cards.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">{empty}</p>;
  }

  return (
    <div className="space-y-2">
      {cards.slice(0, 7).map((card) => (
        <button
          key={card.id}
          onClick={() => onOpenCard(card)}
          className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-800 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          <span className="min-w-0 truncate">{card.title}</span>
          <ArrowRight size={14} className="ml-2 shrink-0 text-gray-400" />
        </button>
      ))}
    </div>
  );
}

export function WeeklyReviewPanel({ open, cards, columns, metrics, onClose, onOpenCard, onComplete }: Props) {
  const titleId = React.useId();
  const summary = React.useMemo(
    () => buildWeeklyReviewSummary(cards, columns, metrics),
    [cards, columns, metrics],
  );
  const completedFocusCount = summary.focusSessionsThisWeek.filter((session) => session.outcome === "completed").length;
  const blockedFocusCount = summary.focusSessionsThisWeek.filter((session) => session.outcome === "blocked").length;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/35 backdrop-blur-sm dark:bg-gray-950/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-[90vh] w-[900px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <Repeat size={20} className="text-emerald-600 dark:text-emerald-400" />
              <h2 id={titleId} className="text-xl font-semibold text-gray-900 dark:text-white">Weekly review</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review the week starting {summary.weekKey} and choose the next commitments.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300" aria-label="Close weekly review">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950">
              <div className="text-xs text-gray-500 dark:text-gray-400">Completed</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{summary.completedThisWeek.length}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950">
              <div className="text-xs text-gray-500 dark:text-gray-400">Focus sessions</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{summary.focusSessionsThisWeek.length}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950">
              <div className="text-xs text-gray-500 dark:text-gray-400">Card completions</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-300">{completedFocusCount}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950">
              <div className="text-xs text-gray-500 dark:text-gray-400">Blocked sessions</div>
              <div className="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-300">{blockedFocusCount}</div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Proposed commitments</h3>
              <CardList cards={summary.proposedCommitments} onOpenCard={onOpenCard} empty="No obvious commitments. Capture or plan the next week manually." />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Recurring blockers</h3>
              <CardList cards={summary.blockedCards} onOpenCard={onOpenCard} empty="No blocked cards right now." />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Stale backlog</h3>
              <CardList cards={summary.staleBacklog} onOpenCard={onOpenCard} empty="No stale backlog cards found." />
            </section>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          {summary.isComplete && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={16} />
              Weekly review complete
            </span>
          )}
          <button onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800">
            Close
          </button>
          <button onClick={() => onComplete(summary.weekKey)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
            Mark complete
          </button>
        </div>
      </div>
    </div>
  );
}
