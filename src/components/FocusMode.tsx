import React from "react";
import { CheckCircle2, CirclePause, CirclePlay, RotateCcw, TimerReset, X } from "lucide-react";
import type { Card, FocusSessionLength, FocusSessionOutcome } from "../app/types";

type Props = {
  open: boolean;
  card: Card | null;
  onClose: () => void;
  onComplete: (details: {
    card: Card;
    outcome: FocusSessionOutcome;
    note?: string;
    plannedMinutes: FocusSessionLength;
    startedAt: string;
    endedAt: string;
  }) => void;
};

const SESSION_LENGTHS: FocusSessionLength[] = [25, 50, 90];

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function FocusMode({ open, card, onClose, onComplete }: Props) {
  const titleId = React.useId();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const [plannedMinutes, setPlannedMinutes] = React.useState<FocusSessionLength>(25);
  const [remainingSeconds, setRemainingSeconds] = React.useState(25 * 60);
  const [running, setRunning] = React.useState(false);
  const [startedAt, setStartedAt] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open || !running) return;
    const id = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          setRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, running]);

  React.useEffect(() => {
    if (!open) return;
    setRunning(false);
    setStartedAt(null);
    setNote("");
    setPlannedMinutes(25);
    setRemainingSeconds(25 * 60);
  }, [card?.id, open]);

  if (!open || !card) return null;

  const hasStarted = startedAt !== null;

  const changeLength = (minutes: FocusSessionLength) => {
    if (hasStarted) return;
    setPlannedMinutes(minutes);
    setRemainingSeconds(minutes * 60);
  };

  const start = () => {
    if (!startedAt) {
      setStartedAt(new Date().toISOString());
    }
    setRunning(true);
  };

  const reset = () => {
    setRunning(false);
    setStartedAt(null);
    setNote("");
    setRemainingSeconds(plannedMinutes * 60);
  };

  const complete = (outcome: FocusSessionOutcome) => {
    const sessionStartedAt = startedAt ?? new Date().toISOString();
    onComplete({
      card,
      outcome,
      note: note.trim() || undefined,
      plannedMinutes,
      startedAt: sessionStartedAt,
      endedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-950/55 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-[560px] max-w-[94vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <TimerReset size={20} />
              <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">Focus session</h2>
            </div>
            <p className="mt-2 truncate text-sm font-medium text-gray-800 dark:text-gray-100">{card.title}</p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            aria-label="Close focus session"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-center justify-center">
            <div className="flex h-44 w-44 items-center justify-center rounded-full border-8 border-emerald-100 bg-emerald-50 text-4xl font-semibold tabular-nums text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
              {formatRemaining(remainingSeconds)}
            </div>
          </div>

          <div className="mt-5 flex justify-center gap-2" aria-label="Session length">
            {SESSION_LENGTHS.map((minutes) => (
              <button
                key={minutes}
                onClick={() => changeLength(minutes)}
                disabled={hasStarted}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  plannedMinutes === minutes
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                {minutes}m
              </button>
            ))}
          </div>

          <div className="mt-5 flex justify-center gap-2">
            {running ? (
              <button
                onClick={() => setRunning(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                <CirclePause size={16} />
                Pause
              </button>
            ) : (
              <button
                onClick={start}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
              >
                <CirclePlay size={16} />
                {hasStarted ? "Resume" : "Start"}
              </button>
            )}
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RotateCcw size={16} />
              Reset
            </button>
          </div>

          <label className="mt-5 block text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="focus-note">
            Session note
          </label>
          <textarea
            id="focus-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            placeholder="What changed, or what blocked you?"
          />

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => complete("progressed")}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Progress made
            </button>
            <button
              onClick={() => complete("blocked")}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              Blocked
            </button>
            <button
              onClick={() => complete("abandoned")}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Stop session
            </button>
            <button
              onClick={() => complete("completed")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              <CheckCircle2 size={16} />
              Completed card
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
