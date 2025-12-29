import React from "react";
import { AnimatePresence } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, ColumnId, SwimlaneId } from "../app/types";
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
  onOpenCard,
  cardRefSetter,
  columnFocused = false,
  focusedCardIndex = null,
  showAgingIndicators = false,
  showUrgencyIndicators = false,
  staleCardIds = new Set(),
  staleCardDays = {},
  reducedMotion = false,
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
  onOpenCard: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
  columnFocused?: boolean;
  focusedCardIndex?: number | null;
  showAgingIndicators?: boolean;
  showUrgencyIndicators?: boolean;
  staleCardIds?: Set<string>;
  staleCardDays?: Record<string, number>;
  reducedMotion?: boolean;
}) {
  // Use composite droppable ID when in a swimlane context
  const droppableId = swimlaneId ? `${swimlaneId}:${id}` : id;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const [text, setText] = React.useState("");

  const headerClass =
    headerState === "full"
      ? "border-rose-400/60 bg-rose-200/30"
      : headerState === "near"
      ? "border-amber-300/50 bg-amber-100/40"
      : "border-amber-700/10 bg-white/70";

  const headerFocusClass =
    columnFocused && focusedCardIndex === null
      ? "ring-2 ring-amber-400/50"
      : "";

  return (
    <div className="w-[280px] shrink-0 sm:w-[320px]">
      <div
        className={`rounded-2xl border ${headerClass} ${headerFocusClass} px-4 py-3`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
            <div className="display-font text-sm font-semibold text-amber-950">
              {icon && <span className="mr-1.5">{icon}</span>}
              {title}
            </div>
          </div>
          <div className="rounded-full border border-amber-700/15 bg-white/80 px-2.5 py-0.5 text-xs text-amber-900/70">
            {countLabel}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 min-h-[260px] space-y-3 rounded-2xl border border-amber-700/10 bg-white/70 p-3 backdrop-blur ${
          isOver ? "ring-2 ring-amber-300/40" : ""
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
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a card…"
            data-column-input={id}
            className="w-full rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-900 outline-none transition focus:border-amber-700/30 focus:bg-amber-50/40"
          />
        </form>
      </div>
    </div>
  );
}
