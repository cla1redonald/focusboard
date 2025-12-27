import type { MetricsState } from "../app/types";
import {
  calculateAverageLeadTime,
  calculateAverageCycleTime,
  calculateThroughput,
  formatDuration,
} from "../app/metrics";

function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
      <div className="text-xs text-emerald-900/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-emerald-950">{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-emerald-900/50">{sublabel}</div>}
    </div>
  );
}

export function MetricsDashboard({
  open,
  metrics,
  onClose,
}: {
  open: boolean;
  metrics: MetricsState;
  onClose: () => void;
}) {
  if (!open) return null;

  const avgLeadTime = calculateAverageLeadTime(metrics);
  const avgCycleTime = calculateAverageCycleTime(metrics);
  const throughput = calculateThroughput(metrics);
  const throughput30d = calculateThroughput(metrics, 30);

  // Calculate flow efficiency (cycle time / lead time)
  const flowEfficiency =
    avgLeadTime && avgCycleTime ? (avgCycleTime / avgLeadTime) * 100 : null;

  // Recent completions
  const recentCompletions = metrics.completedCards.slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-emerald-950">Productivity Metrics</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-emerald-700 transition hover:bg-emerald-600/10"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {metrics.completedCards.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-emerald-600"
              >
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-emerald-950">No data yet</h3>
            <p className="mt-2 text-sm text-emerald-900/60">
              Complete some cards to start tracking your productivity metrics.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="Avg Lead Time"
                value={avgLeadTime ? formatDuration(avgLeadTime) : "-"}
                sublabel="Creation to completion"
              />
              <MetricCard
                label="Avg Cycle Time"
                value={avgCycleTime ? formatDuration(avgCycleTime) : "-"}
                sublabel="Active work to completion"
              />
              <MetricCard
                label="Throughput"
                value={`${throughput.toFixed(1)}`}
                sublabel="Cards per week (7d)"
              />
              <MetricCard
                label="Flow Efficiency"
                value={flowEfficiency ? `${flowEfficiency.toFixed(0)}%` : "-"}
                sublabel="Cycle / Lead time"
              />
            </div>

            <div className="mb-6 grid grid-cols-2 gap-4">
              <MetricCard
                label="Cards Completed"
                value={String(metrics.completedCards.length)}
                sublabel="All time"
              />
              <MetricCard
                label="30-Day Throughput"
                value={`${throughput30d.toFixed(1)}/wk`}
                sublabel="Average weekly rate"
              />
            </div>

            {metrics.wipViolations > 0 && (
              <div className="mb-6 rounded-xl border border-amber-300/50 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-amber-800">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                  </svg>
                  <span className="font-medium">WIP Limit Violations: {metrics.wipViolations}</span>
                </div>
                <p className="mt-1 text-sm text-amber-700">
                  Consider limiting work in progress to improve flow.
                </p>
              </div>
            )}

            <div>
              <h3 className="mb-3 text-sm font-medium text-emerald-900">Recent Completions</h3>
              <div className="space-y-2">
                {recentCompletions.map((card) => (
                  <div
                    key={card.cardId}
                    className="flex items-center justify-between rounded-lg border border-emerald-700/10 bg-emerald-50/50 px-3 py-2"
                  >
                    <span className="truncate text-sm text-emerald-950">{card.title}</span>
                    <div className="flex items-center gap-3 text-xs text-emerald-900/60">
                      <span>Lead: {formatDuration(card.leadTimeMs)}</span>
                      <span>Cycle: {formatDuration(card.cycleTimeMs)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full border border-emerald-700/20 bg-emerald-600/10 px-4 py-2 text-sm text-emerald-900 transition hover:bg-emerald-600/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
