import React from "react";
import { AnimatePresence } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Sparkles, Loader2 } from "lucide-react";
import type { Card, ColumnId, SwimlaneId } from "../app/types";
import { ICON_MAP } from "../app/constants";
import { CardItem } from "./CardItem";
import { EmptyColumnState } from "./EmptyColumnState";

export function Column({
  id,
  swimlaneId,
  title,
  cards,
  accentColor,
  icon,
  countLabel,
  headerState,
  onAdd,
  onAIAdd,
  onOpenCard,
  cardRefSetter,
  columnFocused = false,
  focusedCardIndex = null,
  showAgingIndicators = false,
  showUrgencyIndicators = false,
  staleCardIds = new Set(),
  staleCardDays = {},
  reducedMotion = false,
  aiLoading = false,
}: {
  id: ColumnId;
  swimlaneId?: SwimlaneId;
  title: string;
  cards: Card[];
  accentColor: string;
  icon?: string;
  countLabel: string;
  headerState: "normal" | "near" | "full";
  onAdd: (column: ColumnId, title: string) => void;
  onAIAdd?: (column: ColumnId, input: string) => Promise<void>;
  onOpenCard: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
  columnFocused?: boolean;
  focusedCardIndex?: number | null;
  showAgingIndicators?: boolean;
  showUrgencyIndicators?: boolean;
  staleCardIds?: Set<string>;
  staleCardDays?: Record<string, number>;
  reducedMotion?: boolean;
  aiLoading?: boolean;
}) {
  // Use composite droppable ID when in a swimlane context
  const droppableId = swimlaneId ? `${swimlaneId}:${id}` : id;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const [text, setText] = React.useState("");

  const headerClass =
    headerState === "full"
      ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
      : headerState === "near"
      ? "border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-700"
      : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800";

  const headerFocusClass =
    columnFocused && focusedCardIndex === null
      ? "ring-2 ring-emerald-500/20"
      : "";

  return (
    <div className="flex-1 min-w-[220px] max-w-[400px]">
      <div
        className={`rounded-xl border-l-4 border ${headerClass} ${headerFocusClass} px-3 py-2.5 shadow-sm`}
        style={{ borderLeftColor: accentColor }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon && (() => {
              const IconComponent = ICON_MAP[icon];
              if (IconComponent) {
                return (
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400">
                    <IconComponent size={14} />
                  </div>
                );
              }
              // Fallback to emoji for backwards compatibility
              return <span className="text-base">{icon}</span>;
            })()}
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {title}
            </div>
          </div>
          <div className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {countLabel}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-2 min-h-[260px] space-y-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
          isOver ? "ring-2 ring-emerald-500/20" : ""
        }`}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.length === 0 ? (
            <EmptyColumnState columnId={id} />
          ) : (
            <AnimatePresence mode="popLayout">
              {cards.map((c, idx) => (
                <CardItem
                  key={c.id}
                  card={c}
                  onOpen={onOpenCard}
                  cardRefSetter={cardRefSetter}
                  focused={columnFocused && focusedCardIndex === idx}
                  showAgingIndicator={showAgingIndicators}
                  showUrgencyIndicator={showUrgencyIndicators}
                  isStaleBacklog={staleCardIds.has(c.id)}
                  staleBacklogDays={staleCardDays[c.id] ?? 0}
                  reducedMotion={reducedMotion}
                />
              ))}
            </AnimatePresence>
          )}
        </SortableContext>

        <form
          className="pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            onAdd(id, t);
            setText("");
          }}
        >
          <div className="flex gap-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={onAIAdd ? "Add card or describe with AI…" : "Add a card…"}
              data-column-input={id}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
            />
            {onAIAdd && text.trim() && (
              <button
                type="button"
                onClick={async () => {
                  const t = text.trim();
                  if (!t) return;
                  await onAIAdd(id, t);
                  setText("");
                }}
                disabled={aiLoading}
                className="flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-emerald-600 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                title="Use AI to parse this as natural language"
              >
                {aiLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} />
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
