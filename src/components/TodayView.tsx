import React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Focus, Inbox, Play, X } from "lucide-react";
import type { Card, Column, Settings } from "../app/types";
import { buildTodayPlan, type TodayRecommendation } from "../app/today";

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  settings: Settings;
  captureCount: number;
  onClose: () => void;
  onOpenCard: (card: Card) => void;
  onStartCard: (card: Card) => void;
  onOpenCapture: () => void;
};

function CardTitle({ card }: { card: Card }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
        {card.icon && <span className="mr-1.5">{card.icon}</span>}
        {card.title}
      </div>
      {card.dueDate && (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Due {card.dueDate}</div>
      )}
    </div>
  );
}

function ReasonChips({ recommendation }: { recommendation: TodayRecommendation }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {recommendation.reasons.map((reason) => (
        <span
          key={`${recommendation.card.id}-${reason.kind}`}
          className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        >
          {reason.label}
        </span>
      ))}
    </div>
  );
}

export function TodayView({
  open,
  cards,
  columns,
  settings,
  captureCount,
  onClose,
  onOpenCard,
  onStartCard,
  onOpenCapture,
}: Props) {
  const titleId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);
  const plan = React.useMemo(
    () => buildTodayPlan(cards, columns, { staleBacklogThreshold: settings.staleBacklogThreshold }),
    [cards, columns, settings.staleBacklogThreshold],
  );

  React.useEffect(() => {
    if (!open) return;
    previousActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const attentionItems = [
    { label: "Overdue", value: plan.attention.overdue.length, tone: "text-red-600 dark:text-red-400" },
    { label: "Due today", value: plan.attention.dueToday.length, tone: "text-sky-600 dark:text-sky-400" },
    { label: "Blocked", value: plan.attention.blocked.length, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Stale", value: plan.attention.stale.length, tone: "text-gray-600 dark:text-gray-300" },
  ];

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/35 backdrop-blur-sm dark:bg-gray-950/60" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[90vh] w-[1040px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2">
              <Focus size={20} className="text-emerald-600 dark:text-emerald-400" />
              <h2 id={titleId} className="text-xl font-semibold text-gray-900 dark:text-white">Today</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {plan.activeCount === 0 ? "Nothing active. Capture or plan the next useful thing." : `${plan.activeCount} active task${plan.activeCount === 1 ? "" : "s"} on the board`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="Close Today"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.4fr_0.9fr]">
          <div className="overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recommended focus</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Start with the work that has the clearest reason to matter today.</p>
              </div>
            </div>

            {plan.recommendations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center dark:border-gray-700">
                <CheckCircle2 className="mx-auto text-emerald-500" size={32} />
                <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">No urgent focus candidates</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review the board or triage capture when you are ready to pick the next commitment.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {plan.recommendations.map((recommendation, index) => (
                  <div
                    key={recommendation.card.id}
                    className="rounded-xl border border-gray-200 bg-gray-50 p-4 transition hover:border-emerald-300 dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-emerald-600"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle card={recommendation.card} />
                        <ReasonChips recommendation={recommendation} />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => onOpenCard(recommendation.card)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                          Open
                        </button>
                        {recommendation.card.column === "doing" ? (
                          <button
                            onClick={() => onOpenCard(recommendation.card)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                          >
                            <Play size={14} />
                            Continue
                          </button>
                        ) : (
                          <button
                            onClick={() => onStartCard(recommendation.card)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                          >
                            <Play size={14} />
                            Start
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="overflow-y-auto border-t border-gray-100 bg-gray-50 px-5 py-5 dark:border-gray-800 dark:bg-gray-950/30 lg:border-l lg:border-t-0">
            <div className="grid grid-cols-2 gap-2">
              {attentionItems.map((item) => (
                <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                  <div className={`text-2xl font-semibold ${item.tone}`}>{item.value}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</div>
                </div>
              ))}
            </div>

            <button
              onClick={onOpenCapture}
              className="mt-4 flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-emerald-600 dark:hover:bg-emerald-900/20"
            >
              <span className="flex items-center gap-3">
                <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <Inbox size={18} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">Capture inbox</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {captureCount === 0 ? "Nothing waiting" : `${captureCount} item${captureCount === 1 ? "" : "s"} to triage`}
                  </span>
                </span>
              </span>
              <ArrowRight size={16} className="text-gray-400" />
            </button>

            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                <AlertTriangle size={16} className="text-amber-500" />
                WIP pressure
              </div>
              {plan.wipPressure.length === 0 ? (
                <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                  No columns are at their WIP limit.
                </p>
              ) : (
                <div className="space-y-2">
                  {plan.wipPressure.map((pressure) => (
                    <div key={pressure.column.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-amber-900 dark:text-amber-200">{pressure.column.title}</span>
                        <span className="font-mono text-xs text-amber-700 dark:text-amber-300">{pressure.count}/{pressure.limit}</span>
                      </div>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Move something forward or back before adding more here.</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                <Clock3 size={16} className="text-gray-500" />
                Today rule
              </div>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                Pick one card, move it into Doing, and protect the board from becoming a second inbox.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
