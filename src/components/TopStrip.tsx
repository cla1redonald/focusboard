import type { Card, MetricsState } from "../app/types";
import { MetricsWidget } from "./MetricsWidget";

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
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-700/15 bg-white/70 px-5 py-3 text-sm text-amber-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-600/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          title="Undo (Cmd+Z)"
          aria-label="Undo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-600/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </button>
      </div>
      <div className="h-4 w-px bg-amber-700/20" />
      <div className="text-sm text-amber-900">
        <span className="text-amber-900/70">Doing:</span>{" "}
        <span className="text-amber-950">{doingCard ? doingCard.title : "None"}</span>
      </div>
      <div className="text-sm text-amber-900">
        <span className="text-amber-900/70">Blocked:</span> {blockedCount}
      </div>
      <div className="text-sm text-amber-900">
        <span className="text-amber-900/70">Due today:</span> {dueTodayCount}
      </div>
      {metrics.currentStreak > 0 && (
        <div
          className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-700"
          title={`Longest streak: ${metrics.longestStreak} day${metrics.longestStreak !== 1 ? "s" : ""}`}
        >
          <span>🔥</span>
          <span>{metrics.currentStreak} day{metrics.currentStreak !== 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="ml-auto h-4 w-px bg-amber-700/20" />
      <button
        onClick={onOpenTimeline}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-amber-700 transition hover:bg-amber-600/10"
        title="Open Timeline"
        aria-label="Open Timeline"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-sm">Timeline</span>
      </button>
      <MetricsWidget metrics={metrics} onOpenDashboard={onOpenMetrics} />
    </div>
  );
}
