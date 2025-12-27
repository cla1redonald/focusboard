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
    <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-zinc-200 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      <div className="text-sm text-zinc-200">
        <span className="text-zinc-400">Doing:</span>{" "}
        <span className="text-zinc-100">{doingCard ? doingCard.title : "None"}</span>
      </div>
      <div className="text-sm text-zinc-200">
        <span className="text-zinc-400">Blocked:</span> {blockedCount}
      </div>
      <div className="text-sm text-zinc-200">
        <span className="text-zinc-400">Due today:</span> {dueTodayCount}
      </div>
    </div>
  );
}
