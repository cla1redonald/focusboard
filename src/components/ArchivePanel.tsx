import React from "react";
import { X, Search, RotateCcw, ChevronDown } from "lucide-react";
import type { Card, Column, ColumnId, Tag } from "../app/types";

type Props = {
  open: boolean;
  archivedCards: Card[];
  columns: Column[];
  tags: Tag[];
  onClose: () => void;
  onUnarchive: (id: string, toColumn: ColumnId) => void;
  onOpenCard: (card: Card) => void;
};

export function ArchivePanel({
  open,
  archivedCards,
  columns,
  tags,
  onClose,
  onUnarchive,
  onOpenCard,
}: Props) {
  const [search, setSearch] = React.useState("");
  const [monthFilter, setMonthFilter] = React.useState<string>("all");
  const [restorePickerCardId, setRestorePickerCardId] = React.useState<string | null>(null);

  // Reset state when panel opens
  React.useEffect(() => {
    if (open) {
      setSearch("");
      setMonthFilter("all");
      setRestorePickerCardId(null);
    }
  }, [open]);

  // Close on Escape key, matching other panels
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, onClose]);

  // Sort by archivedAt descending (newest first)
  const sorted = [...archivedCards].sort((a, b) => {
    const aDate = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
    const bDate = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
    return bDate - aDate;
  });

  // Get unique months for the month filter
  const months = React.useMemo(() => {
    const monthSet = new Set<string>();
    for (const card of archivedCards) {
      if (card.archivedAt) {
        const d = new Date(card.archivedAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        monthSet.add(key);
      }
    }
    return Array.from(monthSet).sort().reverse();
  }, [archivedCards]);

  if (!open) return null;

  // Apply search and month filter
  const filtered = sorted.filter((card) => {
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesTitle = card.title.toLowerCase().includes(q);
      const matchesNotes = card.notes?.toLowerCase().includes(q);
      if (!matchesTitle && !matchesNotes) return false;
    }

    // Month filter
    if (monthFilter !== "all" && card.archivedAt) {
      const d = new Date(card.archivedAt);
      const cardMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (cardMonth !== monthFilter) return false;
    }

    return true;
  });

  const getColumnTitle = (columnId: ColumnId): string => {
    return columns.find((c) => c.id === columnId)?.title ?? columnId;
  };

  const getColumnColor = (columnId: ColumnId): string => {
    return columns.find((c) => c.id === columnId)?.color ?? "#64748b";
  };

  const formatDate = (isoDate: string): string => {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatMonthLabel = (monthKey: string): string => {
    const [year, month] = monthKey.split("-");
    const d = new Date(Number(year), Number(month) - 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  // All columns sorted by order for the restore picker
  const allColumns = [...columns].sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-[600px] max-w-[92vw] flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 dark:border-gray-700 px-6 py-4">
          <div>
            <div className="text-xl font-semibold text-gray-900 dark:text-white">Archive</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {archivedCards.length} archived card{archivedCards.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search and Filters */}
        <div className="shrink-0 space-y-3 border-b border-gray-100 dark:border-gray-700 px-6 py-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived cards..."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>

          {months.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Month:</span>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500"
              >
                <option value="all">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Card List */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-3xl mb-3">
                {archivedCards.length === 0 ? "📦" : "🔍"}
              </div>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {archivedCards.length === 0
                  ? "No archived cards yet"
                  : "No cards match your search"}
              </div>
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {archivedCards.length === 0
                  ? "Completed cards from previous months will appear here"
                  : "Try a different search term or month filter"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((card) => (
                <div
                  key={card.id}
                  className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-3 transition hover:border-gray-300 dark:hover:border-gray-600"
                >
                  <div className="flex items-start gap-3">
                    {/* Card icon + title */}
                    <button
                      onClick={() => onOpenCard(card)}
                      className="flex flex-1 items-start gap-2 text-left min-w-0"
                    >
                      <span className="text-base shrink-0 mt-0.5">{card.icon ?? "📄"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {card.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="flex items-center gap-1">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: getColumnColor(card.column) }}
                            />
                            {getColumnTitle(card.column)}
                          </span>
                          {card.archivedAt && (
                            <span>Archived {formatDate(card.archivedAt)}</span>
                          )}
                        </div>
                        {/* Tags */}
                        {card.tags && card.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {card.tags.slice(0, 3).map((tagId) => {
                              const tag = tags.find((t) => t.id === tagId);
                              if (!tag) return null;
                              return (
                                <span
                                  key={tagId}
                                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                  style={{
                                    backgroundColor: `${tag.color}20`,
                                    color: tag.color,
                                  }}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: tag.color }}
                                  />
                                  {tag.name}
                                </span>
                              );
                            })}
                            {card.tags.length > 3 && (
                              <span className="text-[10px] text-gray-400">
                                +{card.tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Restore button / picker */}
                    <div className="shrink-0 relative">
                      {restorePickerCardId === card.id ? (
                        <div className="absolute right-0 top-0 z-10 w-48 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1 shadow-lg">
                          <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            Restore to column
                          </div>
                          {allColumns.map((col) => (
                            <button
                              key={col.id}
                              onClick={() => {
                                onUnarchive(card.id, col.id);
                                setRestorePickerCardId(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-300 transition hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: col.color }}
                              />
                              {col.title}
                            </button>
                          ))}
                          <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                            <button
                              onClick={() => setRestorePickerCardId(null)}
                              className="flex w-full items-center px-3 py-1.5 text-left text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRestorePickerCardId(card.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 transition hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                          title="Restore card"
                        >
                          <RotateCcw size={14} />
                          Restore
                          <ChevronDown size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 dark:border-gray-700 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
