import { Undo2, Redo2, Calendar } from "lucide-react";
import type { Card, MetricsState } from "../app/types";
import { MetricsWidget } from "./MetricsWidget";
import { PomodoroTimer } from "./PomodoroTimer";

export function TopStrip({
  doingCard,
  blockedCount,
  dueTodayCount,
  metrics,
  onOpenMetrics,
  onOpenTimeline,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  doingCard?: Card;
  blockedCount: number;
  dueTodayCount: number;
  metrics: MetricsState;
  onOpenMetrics: () => void;
  onOpenTimeline: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-700 shadow-sm">
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <Redo2 size={16} />
        </button>
      </div>
      <div className="h-4 w-px bg-zinc-200" />
      <div className="text-sm text-zinc-700">
        <span className="text-zinc-500">Doing:</span>{" "}
        <span className="font-medium text-zinc-900">{doingCard ? doingCard.title : "None"}</span>
      </div>
      <div className="text-sm text-zinc-700">
        <span className="text-zinc-500">Blocked:</span> {blockedCount}
      </div>
      <div className="text-sm text-zinc-700">
        <span className="text-zinc-500">Due today:</span> {dueTodayCount}
      </div>
      {metrics.currentStreak > 0 && (
        <div
          className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-sm font-medium text-violet-700"
          title={`Longest streak: ${metrics.longestStreak} day${metrics.longestStreak !== 1 ? "s" : ""}`}
        >
          <span>🔥</span>
          <span>{metrics.currentStreak} day{metrics.currentStreak !== 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="ml-auto h-4 w-px bg-zinc-200" />
      <PomodoroTimer />
      <div className="h-4 w-px bg-zinc-200" />
      <button
        onClick={onOpenTimeline}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
        title="Open Timeline"
        aria-label="Open Timeline"
      >
        <Calendar size={16} />
        <span className="text-sm">Timeline</span>
      </button>
      <MetricsWidget metrics={metrics} onOpenDashboard={onOpenMetrics} />
    </div>
  );
}
