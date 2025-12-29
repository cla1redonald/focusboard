import type { MetricsState } from "../app/types";
import {
  calculateAverageLeadTime,
  calculateAverageCycleTime,
  calculateThroughput,
  formatDuration,
} from "../app/metrics";

export function MetricsWidget({
  metrics,
  onOpenDashboard,
}: {
  metrics: MetricsState;
  onOpenDashboard: () => void;
}) {
  const avgLeadTime = calculateAverageLeadTime(metrics);
  const avgCycleTime = calculateAverageCycleTime(metrics);
  const throughput = calculateThroughput(metrics);

  const hasData = metrics.completedCards.length > 0;

  return (
    <button
      onClick={onOpenDashboard}
      className="group flex items-center gap-3 rounded-lg px-2 py-1 text-left transition hover:bg-gray-100"
      title="View metrics dashboard"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="text-emerald-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <path d="m19 9-5 5-4-4-3 3" />
          </svg>
        </span>
        {hasData ? (
          <>
            <span className="text-gray-500">Lead:</span>
            <span className="font-medium text-gray-900">
              {avgLeadTime ? formatDuration(avgLeadTime) : "-"}
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Cycle:</span>
            <span className="font-medium text-gray-900">
              {avgCycleTime ? formatDuration(avgCycleTime) : "-"}
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Throughput:</span>
            <span className="font-medium text-gray-900">
              {throughput.toFixed(1)}/wk
            </span>
          </>
        ) : (
          <span className="text-gray-500">No completed cards yet</span>
        )}
      </div>
      <span className="text-emerald-600 opacity-0 transition group-hover:opacity-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </span>
    </button>
  );
}
