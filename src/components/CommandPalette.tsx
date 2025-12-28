import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Card, Column } from "../app/types";

type CommandPaletteProps = {
  open: boolean;
  cards: Card[];
  columns: Column[];
  onClose: () => void;
  onOpenCard: (card: Card) => void;
  onOpenSettings: () => void;
  onOpenMetrics: () => void;
  onJumpToColumn: (columnId: string) => void;
};

type ResultItem =
  | { type: "card"; card: Card; column: Column }
  | { type: "column"; column: Column }
  | { type: "action"; id: string; label: string; icon: string };

const QUICK_ACTIONS: { id: string; label: string; icon: string }[] = [
  { id: "settings", label: "Open Settings", icon: "⚙️" },
  { id: "metrics", label: "Open Metrics Dashboard", icon: "📊" },
];

export function CommandPalette({
  open,
  cards,
  columns,
  onClose,
  onOpenCard,
  onOpenSettings,
  onOpenMetrics,
  onJumpToColumn,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Reset state when opened
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filter and build results
  const results = React.useMemo<ResultItem[]>(() => {
    const q = query.toLowerCase().trim();
    const items: ResultItem[] = [];

    // Quick actions (always show if query matches or empty)
    for (const action of QUICK_ACTIONS) {
      if (!q || action.label.toLowerCase().includes(q)) {
        items.push({ type: "action", ...action });
      }
    }

    // Columns (for jumping)
    for (const column of columns) {
      if (!q || column.title.toLowerCase().includes(q)) {
        items.push({ type: "column", column });
      }
    }

    // Cards (search by title)
    for (const card of cards) {
      if (!q || card.title.toLowerCase().includes(q)) {
        const column = columns.find((c) => c.id === card.column);
        if (column) {
          items.push({ type: "card", card, column });
        }
      }
    }

    return items.slice(0, 20); // Limit results
  }, [query, cards, columns]);

  // Keep selected index in bounds
  React.useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Scroll selected item into view
  React.useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const selectedEl = listEl.querySelector(`[data-index="${selectedIndex}"]`);
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeItem = (item: ResultItem) => {
    onClose();
    switch (item.type) {
      case "card":
        onOpenCard(item.card);
        break;
      case "column":
        onJumpToColumn(item.column.id);
        break;
      case "action":
        if (item.id === "settings") onOpenSettings();
        if (item.id === "metrics") onOpenMetrics();
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          executeItem(results[selectedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[1500] bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed left-1/2 top-[20%] z-[1500] w-full max-w-[560px] -translate-x-1/2 overflow-hidden rounded-2xl border border-amber-700/10 bg-white shadow-2xl"
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 border-b border-amber-700/10 px-4 py-3">
              <svg
                className="h-5 w-5 text-amber-700/50"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search cards, columns, or actions..."
                className="flex-1 bg-transparent text-sm text-amber-950 outline-none placeholder:text-amber-700/40"
              />
              <kbd className="rounded border border-amber-700/15 bg-amber-50/60 px-1.5 py-0.5 text-[10px] text-amber-700/70">
                ESC
              </kbd>
            </div>

            {/* Results List */}
            <div ref={listRef} className="max-h-[400px] overflow-y-auto p-2">
              {results.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-amber-700/50">
                  No results found
                </div>
              ) : (
                results.map((item, idx) => (
                  <div
                    key={
                      item.type === "card"
                        ? `card-${item.card.id}`
                        : item.type === "column"
                        ? `col-${item.column.id}`
                        : `action-${item.id}`
                    }
                    data-index={idx}
                    onClick={() => executeItem(item)}
                    className={`cursor-pointer rounded-xl px-3 py-2.5 transition ${
                      selectedIndex === idx
                        ? "bg-amber-100/60"
                        : "hover:bg-amber-50/60"
                    }`}
                  >
                    {item.type === "card" && (
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{item.card.icon || "📄"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium text-amber-950">
                            {item.card.title}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-amber-700/60">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: item.column.color }}
                            />
                            {item.column.title}
                          </div>
                        </div>
                        <span className="text-[10px] text-amber-700/40 uppercase">Card</span>
                      </div>
                    )}

                    {item.type === "column" && (
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{item.column.icon}</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-amber-950">
                            Jump to {item.column.title}
                          </div>
                        </div>
                        <span className="text-[10px] text-amber-700/40 uppercase">Column</span>
                      </div>
                    )}

                    {item.type === "action" && (
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{item.icon}</span>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-amber-950">{item.label}</div>
                        </div>
                        <span className="text-[10px] text-amber-700/40 uppercase">Action</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer hints */}
            <div className="flex items-center justify-between border-t border-amber-700/10 px-4 py-2 text-[10px] text-amber-700/50">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-amber-700/10 bg-amber-50/60 px-1 py-0.5">↑</kbd>
                  <kbd className="rounded border border-amber-700/10 bg-amber-50/60 px-1 py-0.5">↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-amber-700/10 bg-amber-50/60 px-1 py-0.5">↵</kbd>
                  to select
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
