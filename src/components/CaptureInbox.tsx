import React from "react";
import { X, Check, Pencil, ChevronDown, ChevronRight, Inbox, Loader2 } from "lucide-react";
import type { Column, Tag } from "../app/types";
import type { CaptureQueueItem, ParsedCaptureCard } from "../app/captureTypes";
import { SOURCE_CONFIG } from "../app/captureTypes";

type Props = {
  open: boolean;
  reviewItems: CaptureQueueItem[];
  processingItems: CaptureQueueItem[];
  autoAddedItems: CaptureQueueItem[];
  columns: Column[];
  tags: Tag[];
  onClose: () => void;
  onAddCard: (parsedCard: ParsedCaptureCard, captureId: string) => void;
  onDismiss: (captureId: string) => void;
  onDelete: (captureId: string) => void;
};

export function CaptureInbox({
  open,
  reviewItems,
  processingItems,
  autoAddedItems,
  columns,
  tags,
  onClose,
  onAddCard,
  onDismiss,
  onDelete,
}: Props) {
  const [autoAddedExpanded, setAutoAddedExpanded] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editColumn, setEditColumn] = React.useState("");
  const [editSwimlane, setEditSwimlane] = React.useState<"work" | "personal">("work");
  const [editDueDate, setEditDueDate] = React.useState("");
  const [editTags, setEditTags] = React.useState<string[]>([]);
  const [now, setNow] = React.useState(0);

  // Reset state when panel opens and update current time
  React.useEffect(() => {
    if (open) {
      setAutoAddedExpanded(false);
      setEditingId(null);
      setNow(Date.now());
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

  if (!open) return null;

  const totalCount = reviewItems.length + processingItems.length;
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  const getColumnTitle = (columnId: string): string => {
    return columns.find((c) => c.id === columnId)?.title ?? columnId;
  };

  const formatRelativeTime = (isoDate: string): string => {
    const then = new Date(isoDate).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const startEditing = (item: CaptureQueueItem, card: ParsedCaptureCard) => {
    setEditingId(item.id);
    setEditTitle(card.title);
    setEditColumn(card.suggestedColumn ?? "backlog");
    setEditSwimlane(card.swimlane ?? "work");
    setEditDueDate(card.dueDate ?? "");
    setEditTags(card.tags ?? []);
  };

  const confirmEdit = (captureId: string) => {
    onAddCard(
      {
        title: editTitle,
        suggestedColumn: editColumn,
        swimlane: editSwimlane,
        dueDate: editDueDate || undefined,
        tags: editTags,
        confidence: 1,
      },
      captureId
    );
    setEditingId(null);
  };

  const handleAddAll = () => {
    for (const item of reviewItems) {
      const card = item.parsed_cards?.[0];
      if (card) {
        onAddCard(card, item.id);
      }
    }
  };

  const renderCard = (item: CaptureQueueItem, card: ParsedCaptureCard, idx: number) => {
    const source = SOURCE_CONFIG[item.source];
    const isEditing = editingId === item.id;

    return (
      <div
        key={`${item.id}-${idx}`}
        className={`group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 border-l-4 ${source.borderColor} ${source.darkBorderColor} p-3 transition hover:border-gray-300 dark:hover:border-gray-600`}
      >
        {/* Source badge + timestamp */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">{source.icon}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {source.label}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatRelativeTime(item.created_at)}
            </span>
          </div>
          <button
            onClick={() => onDismiss(item.id)}
            className="rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-400"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>

        {isEditing ? (
          /* Inline editor */
          <div className="space-y-2">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={editColumn}
                onChange={(e) => setEditColumn(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-500"
              >
                {sortedColumns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.icon} {col.title}
                  </option>
                ))}
              </select>
              <select
                value={editSwimlane}
                onChange={(e) => setEditSwimlane(e.target.value as "work" | "personal")}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-500"
              >
                <option value="work">Work</option>
                <option value="personal">Personal</option>
              </select>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-500"
              />
            </div>
            {/* Tag picker */}
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => {
                const selected = editTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() =>
                      setEditTags((prev) =>
                        selected ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                      )
                    }
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                      selected
                        ? "ring-2 ring-emerald-500/40"
                        : "opacity-50 hover:opacity-80"
                    }`}
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
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => confirmEdit(item.id)}
                className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-600"
              >
                Add Card
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1 text-xs text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* AI-generated title */}
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-1.5">
              {card.title}
            </div>

            {/* Notes preview */}
            {card.notes && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                {card.notes}
              </div>
            )}

            {/* Tag chips + suggested column */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {card.tags?.map((tagId) => {
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
              {card.suggestedColumn && (
                <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[10px] text-gray-600 dark:text-gray-400">
                  {getColumnTitle(card.suggestedColumn)}
                </span>
              )}
              {card.swimlane && card.swimlane !== "work" && (
                <span className="rounded-full bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400">
                  Personal
                </span>
              )}
            </div>

            {/* Missing field nudges */}
            {!card.dueDate && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-2 italic">
                No due date — add one?
              </div>
            )}

            {/* Confidence indicator + action buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    card.confidence >= 0.8
                      ? "bg-emerald-500"
                      : card.confidence >= 0.5
                        ? "bg-amber-500"
                        : "bg-red-400"
                  }`}
                />
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {Math.round(card.confidence * 100)}% confidence
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onAddCard(card, item.id)}
                  className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600 transition hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                  title="Add as-is"
                  aria-label="Add card"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => startEditing(item, card)}
                  className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title="Edit & Add"
                  aria-label="Edit card"
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>

            {/* Duplicate warning */}
            {card.duplicateOf && (
              <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400">
                Possible duplicate of &ldquo;{card.duplicateOf}&rdquo;
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-[600px] max-w-[92vw] flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 dark:border-gray-700 px-6 py-4">
          <div>
            <div className="text-xl font-semibold text-gray-900 dark:text-white">Capture Inbox</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {totalCount === 0
                ? "No items to review"
                : `${totalCount} item${totalCount !== 1 ? "s" : ""} to review`}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {/* Empty state */}
          {reviewItems.length === 0 && processingItems.length === 0 && autoAddedItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-gray-100 dark:bg-gray-700 p-4">
                <Inbox size={32} className="text-gray-400 dark:text-gray-500" />
              </div>
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                No captured items yet
              </div>
              <div className="mt-1 max-w-xs text-xs text-gray-400 dark:text-gray-500">
                Send tasks from Slack, email, or your browser. Set up channels to start capturing.
              </div>
            </div>
          )}

          {/* Processing section */}
          {processingItems.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Processing
              </div>
              <div className="space-y-2">
                {processingItems.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-3"
                  >
                    <Loader2 size={16} className="animate-spin text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {item.raw_content.substring(0, 80)}
                        {item.raw_content.length > 80 ? "..." : ""}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">
                        {SOURCE_CONFIG[item.source].icon} {SOURCE_CONFIG[item.source].label} &middot; {formatRelativeTime(item.created_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => onDismiss(item.id)}
                      className="rounded-md p-1 text-gray-300 opacity-0 transition hover:bg-gray-100 hover:text-gray-500 group-hover:opacity-100 dark:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-400 shrink-0"
                      aria-label="Dismiss"
                      title="Cancel processing"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review section */}
          {reviewItems.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Ready for Review
                </span>
                {reviewItems.length > 1 && (
                  <button
                    onClick={handleAddAll}
                    className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 transition hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                  >
                    Add all ({reviewItems.length})
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {reviewItems.map((item) =>
                  item.parsed_cards?.map((card, idx) => renderCard(item, card, idx)) ?? (
                    <div key={item.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 p-3 text-sm text-gray-500">
                      {item.raw_content.substring(0, 120)}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Auto-added section (collapsible) */}
          {autoAddedItems.length > 0 && (
            <div>
              <button
                onClick={() => setAutoAddedExpanded((prev) => !prev)}
                className="mb-2 flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 transition hover:text-gray-600 dark:hover:text-gray-300"
              >
                {autoAddedExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Recently Auto-Added ({autoAddedItems.length})
              </button>
              {autoAddedExpanded && (
                <div className="space-y-2">
                  {autoAddedItems.map((item) => {
                    const card = item.parsed_cards?.[0];
                    if (!card) return null;
                    const source = SOURCE_CONFIG[item.source];
                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 border-l-4 ${source.borderColor} ${source.darkBorderColor} p-3 opacity-70`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{source.icon}</span>
                            <span className="text-sm text-gray-700 dark:text-gray-300">{card.title}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              {formatRelativeTime(item.created_at)}
                            </span>
                            <button
                              onClick={() => onDelete(item.id)}
                              className="rounded-md p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-400"
                              aria-label="Remove"
                              title="Undo auto-add"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
