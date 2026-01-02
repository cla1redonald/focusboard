import React from "react";
import type { Card, Column, TimelineCard } from "../app/types";
import { getUrgencyLevel, getUrgencyColor, getUrgencyLabel } from "../app/urgency";

type Props = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  onClose: () => void;
  onOpenCard: (card: Card) => void;
};

type TimelineGrouping = "column" | "urgency" | "flat";
type DateRange = "week" | "month" | "quarter";

export function TimelinePanel({ open, cards, columns, onClose, onOpenCard }: Props) {
  const [grouping, setGrouping] = React.useState<TimelineGrouping>("column");
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [dateRange, setDateRange] = React.useState<DateRange>("month");

  // Calculate date range for x-axis
  const { startDate, endDate, totalDays } = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const start = new Date(now);
    const end = new Date(now);

    // Start from 7 days ago to show some past context
    start.setDate(start.getDate() - 7);

    switch (dateRange) {
      case "week":
        end.setDate(end.getDate() + 7);
        break;
      case "month":
        end.setDate(end.getDate() + 30);
        break;
      case "quarter":
        end.setDate(end.getDate() + 90);
        break;
    }

    return {
      startDate: start,
      endDate: end,
      totalDays: Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
    };
  }, [dateRange]);

  // Prepare timeline data
  const timelineCards = React.useMemo(() => {
    const terminalColumnIds = new Set(columns.filter((c) => c.isTerminal).map((c) => c.id));
    const columnMap = new Map(columns.map((c) => [c.id, c]));

    return cards
      .filter((card) => {
        // Filter out completed cards unless requested
        if (!showCompleted && terminalColumnIds.has(card.column)) {
          return false;
        }
        return true;
      })
      .map((card): TimelineCard => {
        const column = columnMap.get(card.column);
        return {
          card,
          columnTitle: column?.title ?? card.column,
          columnColor: column?.color ?? "#F59E0B",
          startDate: new Date(card.createdAt),
          endDate: card.dueDate ? new Date(card.dueDate) : null,
          urgencyLevel: getUrgencyLevel(card),
        };
      });
  }, [cards, columns, showCompleted]);

  // Group cards based on grouping option
  const groupedCards = React.useMemo(() => {
    if (grouping === "flat") {
      return { "All Cards": timelineCards };
    }
    if (grouping === "urgency") {
      const groups: Record<string, TimelineCard[]> = {
        Critical: [],
        High: [],
        Medium: [],
        Low: [],
        "No Due Date": [],
      };
      for (const tc of timelineCards) {
        const key =
          tc.urgencyLevel === "none"
            ? "No Due Date"
            : tc.urgencyLevel === "critical"
            ? "Critical"
            : tc.urgencyLevel.charAt(0).toUpperCase() + tc.urgencyLevel.slice(1);
        if (groups[key]) groups[key].push(tc);
      }
      // Remove empty groups
      return Object.fromEntries(Object.entries(groups).filter(([, cards]) => cards.length > 0));
    }
    // Group by column
    const groups: Record<string, TimelineCard[]> = {};
    const sortedColumns = [...columns].sort((a, b) => a.order - b.order);
    for (const col of sortedColumns) {
      const colCards = timelineCards.filter((tc) => tc.card.column === col.id);
      if (colCards.length > 0) {
        groups[col.title] = colCards;
      }
    }
    return groups;
  }, [timelineCards, grouping, columns]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/20 dark:bg-black/40" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Timeline</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 dark:text-gray-400 transition hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
          {/* Grouping selector */}
          <div className="flex gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-1">
            {(["column", "urgency", "flat"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGrouping(g)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  grouping === g
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {g === "column" ? "By Column" : g === "urgency" ? "By Urgency" : "Flat"}
              </button>
            ))}
          </div>

          {/* Date range selector */}
          <div className="flex gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-1">
            {(["week", "month", "quarter"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  dateRange === r
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {r === "week" ? "Week" : r === "month" ? "Month" : "Quarter"}
              </button>
            ))}
          </div>

          {/* Show completed toggle */}
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-600"
            />
            Show completed
          </label>
        </div>

        {/* Timeline Chart */}
        <div className="max-h-[60vh] overflow-auto px-6 py-4">
          {Object.keys(groupedCards).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500">
              <svg className="mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                />
              </svg>
              <div className="text-sm">No cards to display</div>
            </div>
          ) : (
            <TimelineChart
              groupedCards={groupedCards}
              startDate={startDate}
              endDate={endDate}
              totalDays={totalDays}
              onOpenCard={onOpenCard}
            />
          )}
        </div>

        {/* Legend */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3">
          <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#DC2626]" />
              <span>Overdue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#F97316]" />
              <span>Due in 3 days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#EAB308]" />
              <span>Due in 7 days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#3B82F6]" />
              <span>Due in 14 days</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded bg-gray-200 dark:bg-gray-600" />
              <span>No due date</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Inner component for the SVG timeline chart
function TimelineChart({
  groupedCards,
  startDate,
  endDate,
  totalDays,
  onOpenCard,
}: {
  groupedCards: Record<string, TimelineCard[]>;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  onOpenCard: (card: Card) => void;
}) {
  const groups = Object.entries(groupedCards);
  const rowHeight = 28;
  const groupHeaderHeight = 28;
  const leftPadding = 160;
  const rightPadding = 20;
  const topPadding = 30;

  // Calculate total rows
  let totalRows = 0;
  for (const [, cards] of groups) {
    totalRows += cards.length + 1; // +1 for group header
  }

  const height = topPadding + totalRows * rowHeight + 20;
  const width = 900;
  const chartWidth = width - leftPadding - rightPadding;

  // X scale: date to pixel
  const xScale = (date: Date) => {
    const daysSinceStart = (date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    return leftPadding + (daysSinceStart / totalDays) * chartWidth;
  };

  // Generate date markers
  const dateMarkers: Date[] = [];
  const markerInterval = totalDays <= 14 ? 1 : totalDays <= 40 ? 7 : 14;
  const markerDate = new Date(startDate);
  while (markerDate <= endDate) {
    dateMarkers.push(new Date(markerDate));
    markerDate.setDate(markerDate.getDate() + markerInterval);
  }

  // Today line
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayX = xScale(today);

  let currentY = topPadding;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[700px]" style={{ width: "100%", height: `${height}px` }}>
        {/* Date axis labels */}
        {dateMarkers.map((date, i) => {
          const x = xScale(date);
          if (x < leftPadding || x > width - rightPadding) return null;
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={topPadding - 5}
                y2={height - 10}
                stroke="#78716c"
                strokeOpacity={0.15}
                strokeDasharray="2,2"
              />
              <text x={x} y={topPadding - 12} textAnchor="middle" fontSize={10} fill="#78716c" fillOpacity={0.7}>
                {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            </g>
          );
        })}

        {/* Today line */}
        {todayX >= leftPadding && todayX <= width - rightPadding && (
          <>
            <line
              x1={todayX}
              x2={todayX}
              y1={topPadding - 5}
              y2={height - 10}
              stroke="#EF4444"
              strokeWidth={2}
              strokeOpacity={0.7}
            />
            <text x={todayX} y={topPadding - 12} textAnchor="middle" fontSize={10} fill="#EF4444" fontWeight="600">
              Today
            </text>
          </>
        )}

        {/* Groups and bars */}
        {groups.map(([groupName, cards]) => {
          const groupStartY = currentY;
          currentY += groupHeaderHeight;

          const bars = cards.map((tc, idx) => {
            const y = currentY + idx * rowHeight;
            const barStartDate = tc.startDate < startDate ? startDate : tc.startDate;
            const barEndDate = tc.endDate
              ? tc.endDate > endDate
                ? endDate
                : tc.endDate
              : endDate;

            const barStart = Math.max(xScale(barStartDate), leftPadding);
            const barEnd = Math.min(xScale(barEndDate), width - rightPadding);
            const barWidth = Math.max(barEnd - barStart, 8);

            const barColor = tc.endDate ? getUrgencyColor(tc.urgencyLevel) : tc.columnColor;
            const hasNoDueDate = !tc.endDate;

            return (
              <g key={tc.card.id} className="cursor-pointer" onClick={() => onOpenCard(tc.card)}>
                {/* Card title (truncated) */}
                <text
                  x={leftPadding - 8}
                  y={y + rowHeight / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#44403c"
                  className="pointer-events-none"
                >
                  {tc.card.icon && `${tc.card.icon} `}
                  {tc.card.title.length > 16 ? tc.card.title.slice(0, 16) + "..." : tc.card.title}
                </text>

                {/* Bar */}
                <rect
                  x={barStart}
                  y={y + 4}
                  width={barWidth}
                  height={rowHeight - 8}
                  rx={4}
                  fill={barColor}
                  fillOpacity={hasNoDueDate ? 0.3 : 0.7}
                  stroke={barColor}
                  strokeWidth={1}
                  strokeOpacity={hasNoDueDate ? 0.4 : 0.9}
                  className="transition hover:fill-opacity-100"
                />

                {/* Due date indicator or "No due date" label */}
                {hasNoDueDate && barWidth > 60 && (
                  <text
                    x={barStart + barWidth / 2}
                    y={y + rowHeight / 2 + 3}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#78716c"
                    className="pointer-events-none"
                  >
                    No due date
                  </text>
                )}

                {/* Urgency label on bar */}
                {tc.endDate && tc.urgencyLevel !== "none" && barWidth > 50 && (
                  <text
                    x={barStart + barWidth / 2}
                    y={y + rowHeight / 2 + 3}
                    textAnchor="middle"
                    fontSize={9}
                    fill="white"
                    fontWeight="500"
                    className="pointer-events-none"
                  >
                    {getUrgencyLabel(tc.urgencyLevel)}
                  </text>
                )}
              </g>
            );
          });

          currentY += cards.length * rowHeight;

          return (
            <g key={groupName}>
              {/* Group header */}
              <text x={10} y={groupStartY + groupHeaderHeight / 2 + 4} fontSize={12} fontWeight="600" fill="#44403c">
                {groupName} ({cards.length})
              </text>
              <line
                x1={10}
                x2={width - 10}
                y1={groupStartY + groupHeaderHeight - 2}
                y2={groupStartY + groupHeaderHeight - 2}
                stroke="#78716c"
                strokeOpacity={0.15}
              />
              {bars}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
