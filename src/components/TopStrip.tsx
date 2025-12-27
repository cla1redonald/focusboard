import type { Card } from "../app/types";

export function TopStrip({
  doingCard,
  blockedCount,
  dueTodayCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  doingCard?: Card;
  blockedCount: number;
  dueTodayCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-700/15 bg-white/70 px-5 py-3 text-sm text-emerald-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-lg p-1.5 text-emerald-700 transition hover:bg-emerald-600/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
          className="rounded-lg p-1.5 text-emerald-700 transition hover:bg-emerald-600/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          title="Redo (Cmd+Shift+Z)"
          aria-label="Redo"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </button>
      </div>
      <div className="h-4 w-px bg-emerald-700/20" />
      <div className="text-sm text-emerald-900">
        <span className="text-emerald-900/70">Doing:</span>{" "}
        <span className="text-emerald-950">{doingCard ? doingCard.title : "None"}</span>
      </div>
      <div className="text-sm text-emerald-900">
        <span className="text-emerald-900/70">Blocked:</span> {blockedCount}
      </div>
      <div className="text-sm text-emerald-900">
        <span className="text-emerald-900/70">Due today:</span> {dueTodayCount}
      </div>
    </div>
  );
}
