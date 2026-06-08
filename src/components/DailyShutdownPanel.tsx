import React from "react";
import { ArrowRight, CheckCircle2, Moon, X } from "lucide-react";
import type { Card, Column, MetricsState } from "../app/types";
import { buildDailyShutdownSummary } from "../app/review";

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  metrics: MetricsState;
  onClose: () => void;
  onOpenCard: (card: Card) => void;
  onComplete: (date: string) => void;
};

function CardList({ cards, onOpenCard, empty }: { cards: Card[]; onOpenCard: (card: Card) => void; empty: string }) {
  if (cards.length === 0) {
    return <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">{empty}</p>;
  }

  return (
    <div className="space-y-2">
      {cards.slice(0, 5).map((card) => (
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

export function DailyShutdownPanel({ open, cards, columns, metrics, onClose, onOpenCard, onComplete }: Props) {
  const titleId = React.useId();
  const summary = React.useMemo(
    () => buildDailyShutdownSummary(cards, columns, metrics),
    [cards, columns, metrics],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/35 backdrop-blur-sm dark:bg-gray-950/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex max-h-[90vh] w-[820px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <Moon size={20} className="text-emerald-600 dark:text-emerald-400" />
              <h2 id={titleId} className="text-xl font-semibold text-gray-900 dark:text-white">Daily shutdown</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Close the loop before tomorrow starts borrowing attention.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300" aria-label="Close daily shutdown">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2">
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Wins</h3>
            <p className="mt-1 text-3xl font-semibold text-emerald-700 dark:text-emerald-300">{summary.completedToday.length}</p>
            <p className="text-sm text-emerald-800/80 dark:text-emerald-200/80">cards completed today</p>
            <p className="mt-3 text-sm text-emerald-800/80 dark:text-emerald-200/80">{summary.focusSessionsToday.length} focus session{summary.focusSessionsToday.length === 1 ? "" : "s"} logged</p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Tomorrow candidates</h3>
            <CardList cards={summary.tomorrowCandidates} onOpenCard={onOpenCard} empty="No obvious candidate. Capture one clear next step tomorrow." />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Slipped work</h3>
            <CardList cards={summary.slippedCards} onOpenCard={onOpenCard} empty="Nothing overdue." />
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Blocked and stale</h3>
            <CardList cards={[...summary.blockedCards, ...summary.staleCards]} onOpenCard={onOpenCard} empty="No blocked or stale work needing attention." />
          </section>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          {summary.isComplete && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={16} />
              Shutdown complete
            </span>
          )}
          <button onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800">
            Close
          </button>
          <button onClick={() => onComplete(summary.date)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">
            Mark complete
          </button>
        </div>
      </div>
    </div>
  );
}
