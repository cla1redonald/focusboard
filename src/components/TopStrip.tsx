import type { Card } from "../app/types";

export function TopStrip({
  doingCard,
  blockedCount,
  dueTodayCount,
}: {
  doingCard?: Card;
  blockedCount: number;
  dueTodayCount: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-700/15 bg-white/70 px-5 py-3 text-sm text-emerald-900 shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
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
