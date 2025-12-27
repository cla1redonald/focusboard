import React from "react";
import type { Card, Column, MetricsState, Settings } from "../app/types";
import {
  calculateAverageLeadTime,
  calculateAverageCycleTime,
  calculateThroughput,
  formatDuration,
  getStaleCards,
  getColumnAgeStats,
  getCycleTimeDistribution,
  getBlockedTimeAnalysis,
  getCumulativeFlowData,
} from "../app/metrics";

type TabId = "overview" | "flow" | "blocked" | "stale";

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

function CycleTimeChart({ metrics }: { metrics: MetricsState }) {
  const distribution = React.useMemo(
    () => getCycleTimeDistribution(metrics),
    [metrics]
  );

  if (distribution.length === 0) return null;

  const maxPercentage = Math.max(...distribution.map((b) => b.percentage));

  return (
    <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
      <div className="mb-3 text-sm font-medium text-emerald-900">Cycle Time Distribution</div>
      <div className="space-y-2">
        {distribution.map((bucket) => (
          <div key={bucket.label} className="flex items-center gap-3">
            <div className="w-16 text-xs text-emerald-900/70">{bucket.label}</div>
            <div className="flex-1">
              <div
                className="h-5 rounded bg-emerald-500/80 transition-all"
                style={{ width: `${(bucket.percentage / maxPercentage) * 100}%` }}
              />
            </div>
            <div className="w-16 text-right text-xs text-emerald-900/60">
              {bucket.count} ({bucket.percentage.toFixed(0)}%)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnAgePanel({ cards, columns }: { cards: Card[]; columns: Column[] }) {
  const ageStats = React.useMemo(
    () => getColumnAgeStats(cards, columns),
    [cards, columns]
  );

  if (ageStats.length === 0) return null;

  return (
    <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
      <div className="mb-3 text-sm font-medium text-emerald-900">Age by Column</div>
      <div className="space-y-2">
        {ageStats.map((stat) => (
          <div
            key={stat.columnId}
            className="flex items-center gap-3 rounded-lg border border-emerald-700/10 bg-emerald-50/50 px-3 py-2"
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: stat.columnColor }}
            />
            <div className="flex-1">
              <div className="text-sm text-emerald-950">{stat.columnTitle}</div>
              <div className="text-xs text-emerald-900/60">
                {stat.cardCount} card{stat.cardCount !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-emerald-900">
                avg: {stat.avgAgeMs > 0 ? formatDuration(stat.avgAgeMs) : "-"}
              </div>
              <div className="text-xs text-emerald-900/60">
                max: {stat.maxAgeMs > 0 ? formatDuration(stat.maxAgeMs) : "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CumulativeFlowDiagram({
  metrics,
  columns,
}: {
  metrics: MetricsState;
  columns: Column[];
}) {
  const [days, setDays] = React.useState<30 | 60 | 90>(30);

  const data = React.useMemo(
    () => getCumulativeFlowData(metrics.dailySnapshots, columns, days),
    [metrics.dailySnapshots, columns, days]
  );

  if (data.length < 2) {
    return (
      <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-emerald-900">Cumulative Flow Diagram</div>
        </div>
        <div className="py-8 text-center text-sm text-emerald-900/60">
          Need at least 2 days of snapshots to display. Keep using Focusboard!
        </div>
      </div>
    );
  }

  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
  const maxValue = Math.max(...data.map((d) => {
    const lastCol = sortedColumns[sortedColumns.length - 1];
    return d.cumulativeCounts[lastCol?.id] ?? 0;
  }));

  const width = 500;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const xScale = (i: number) => padding.left + (i / (data.length - 1)) * chartWidth;
  const yScale = (v: number) => padding.top + chartHeight - (v / (maxValue || 1)) * chartHeight;

  return (
    <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-emerald-900">Cumulative Flow Diagram</div>
        <div className="flex gap-1">
          {([30, 60, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2 py-1 text-xs transition ${
                days === d
                  ? "bg-emerald-600 text-white"
                  : "text-emerald-900/60 hover:bg-emerald-100"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Areas - render from top to bottom (reversed order) */}
        {[...sortedColumns].reverse().map((col) => {
          const points = data.map((d, i) => {
            const y = d.cumulativeCounts[col.id] ?? 0;
            return `${xScale(i)},${yScale(y)}`;
          });
          const bottomPoints = data.map((_, i) => `${xScale(i)},${yScale(0)}`).reverse();
          const pathD = `M${points.join(" L")} L${bottomPoints.join(" L")} Z`;

          return (
            <path
              key={col.id}
              d={pathD}
              fill={col.color}
              fillOpacity={0.7}
              stroke={col.color}
              strokeWidth={1}
            />
          );
        })}

        {/* Y axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yScale(maxValue * ratio)}
              y2={yScale(maxValue * ratio)}
              stroke="#064e3b"
              strokeOpacity={0.1}
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 5}
              y={yScale(maxValue * ratio)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="#064e3b"
              fillOpacity={0.6}
            >
              {Math.round(maxValue * ratio)}
            </text>
          </g>
        ))}

        {/* X axis dates */}
        {data.filter((_, i) => i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)).map((d, idx) => {
          const realIdx = idx === 0 ? 0 : idx === 1 ? Math.floor(data.length / 2) : data.length - 1;
          return (
            <text
              key={d.date}
              x={xScale(realIdx)}
              y={height - 10}
              textAnchor="middle"
              fontSize={10}
              fill="#064e3b"
              fillOpacity={0.6}
            >
              {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3">
        {sortedColumns.map((col) => (
          <div key={col.id} className="flex items-center gap-1.5">
            <div
              className="h-3 w-3 rounded"
              style={{ backgroundColor: col.color }}
            />
            <span className="text-xs text-emerald-900/70">{col.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockedPanel({
  cards,
  metrics,
  onOpenCard,
}: {
  cards: Card[];
  metrics: MetricsState;
  onOpenCard: (card: Card) => void;
}) {
  const blockedStats = React.useMemo(
    () => getBlockedTimeAnalysis(cards, metrics),
    [cards, metrics]
  );

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          label="Avg Blocked Time"
          value={blockedStats.avgBlockedTimeMs > 0 ? formatDuration(blockedStats.avgBlockedTimeMs) : "-"}
          sublabel="Per blocked period"
        />
        <MetricCard
          label="Currently Blocked"
          value={String(blockedStats.currentlyBlocked.length)}
          sublabel="Cards"
        />
      </div>

      {/* Currently blocked cards */}
      {blockedStats.currentlyBlocked.length > 0 && (
        <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
          <div className="mb-3 text-sm font-medium text-emerald-900">Currently Blocked</div>
          <div className="space-y-2">
            {blockedStats.currentlyBlocked.map(({ card, blockedSinceMs }) => (
              <button
                key={card.id}
                onClick={() => onOpenCard(card)}
                className="flex w-full items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-left transition hover:bg-rose-100"
              >
                <div>
                  <div className="text-sm text-emerald-950">{card.title}</div>
                  {card.blockedReason && (
                    <div className="text-xs text-rose-700">{card.blockedReason}</div>
                  )}
                </div>
                <div className="text-xs text-rose-600">
                  {formatDuration(blockedSinceMs)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Frequently blocked */}
      {blockedStats.frequentlyBlocked.length > 0 && (
        <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
          <div className="mb-3 text-sm font-medium text-emerald-900">Frequently Blocked Cards</div>
          <div className="space-y-2">
            {blockedStats.frequentlyBlocked.map((item) => (
              <div
                key={item.cardId}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <span className="text-sm text-emerald-950">{item.title}</span>
                <span className="text-xs text-amber-700">{item.blockCount}x blocked</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {blockedStats.currentlyBlocked.length === 0 && blockedStats.frequentlyBlocked.length === 0 && (
        <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-8 text-center">
          <div className="text-emerald-600 mb-2">✓</div>
          <div className="text-sm text-emerald-900/70">No blocked cards. Great flow!</div>
        </div>
      )}
    </div>
  );
}

function StaleCardsPanel({
  cards,
  columns,
  settings,
  onOpenCard,
}: {
  cards: Card[];
  columns: Column[];
  settings: Settings;
  onOpenCard: (card: Card) => void;
}) {
  const staleCards = React.useMemo(
    () => getStaleCards(cards, columns, settings.staleCardThreshold),
    [cards, columns, settings.staleCardThreshold]
  );

  if (staleCards.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-8 text-center">
        <div className="text-emerald-600 mb-2">✓</div>
        <div className="text-sm text-emerald-900/70">
          No stale cards (threshold: {settings.staleCardThreshold} days)
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="mb-3 text-sm text-emerald-900/60">
        Cards not updated in {settings.staleCardThreshold}+ days
      </div>
      {staleCards.map(({ card, columnTitle, daysSinceUpdate }) => (
        <button
          key={card.id}
          onClick={() => onOpenCard(card)}
          className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left transition hover:bg-amber-100"
        >
          <div>
            <div className="text-sm text-emerald-950">{card.title}</div>
            <div className="text-xs text-emerald-900/60">{columnTitle}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium text-amber-700">{daysSinceUpdate}d stale</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export function MetricsDashboard({
  open,
  metrics,
  cards,
  columns,
  settings,
  onClose,
  onOpenCard,
}: {
  open: boolean;
  metrics: MetricsState;
  cards: Card[];
  columns: Column[];
  settings: Settings;
  onClose: () => void;
  onOpenCard: (card: Card) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<TabId>("overview");

  if (!open) return null;

  const avgLeadTime = calculateAverageLeadTime(metrics);
  const avgCycleTime = calculateAverageCycleTime(metrics);
  const throughput = calculateThroughput(metrics);
  const throughput30d = calculateThroughput(metrics, 30);

  const flowEfficiency =
    avgLeadTime && avgCycleTime ? (avgCycleTime / avgLeadTime) * 100 : null;

  const recentCompletions = metrics.completedCards.slice(0, 5);

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "flow", label: "Flow Analysis" },
    { id: "blocked", label: "Blocked" },
    { id: "stale", label: "Stale Cards" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
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

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg border border-emerald-700/15 bg-emerald-50/50 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-white text-emerald-900 shadow-sm"
                  : "text-emerald-900/60 hover:text-emerald-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <>
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
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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

                <div className="grid grid-cols-2 gap-4">
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
                  <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-4">
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

                <CycleTimeChart metrics={metrics} />

                <ColumnAgePanel cards={cards} columns={columns} />

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
              </div>
            )}
          </>
        )}

        {activeTab === "flow" && (
          <CumulativeFlowDiagram metrics={metrics} columns={columns} />
        )}

        {activeTab === "blocked" && (
          <BlockedPanel cards={cards} metrics={metrics} onOpenCard={onOpenCard} />
        )}

        {activeTab === "stale" && (
          <StaleCardsPanel
            cards={cards}
            columns={columns}
            settings={settings}
            onOpenCard={onOpenCard}
          />
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
