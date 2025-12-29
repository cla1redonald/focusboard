import React from "react";
import { AnimatePresence } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Archive,
  Palette,
  ListTodo,
  Zap,
  Ban,
  CheckCircle,
  Lightbulb,
  Rocket,
  Target,
  Package,
  Brain,
  Flame,
  type LucideIcon,
} from "lucide-react";
import type { Card, ColumnId, SwimlaneId } from "../app/types";
import { CardItem } from "./CardItem";
import { EmptyColumnState } from "./EmptyColumnState";

// Map icon names to Lucide components
const ICON_MAP: Record<string, LucideIcon> = {
  archive: Archive,
  palette: Palette,
  "list-todo": ListTodo,
  zap: Zap,
  ban: Ban,
  "check-circle": CheckCircle,
  lightbulb: Lightbulb,
  rocket: Rocket,
  target: Target,
  package: Package,
  brain: Brain,
  flame: Flame,
};

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
      ? "border-red-200 bg-red-50"
      : headerState === "near"
      ? "border-amber-200 bg-amber-50"
      : "border-gray-200 bg-white";

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
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-emerald-600">
                    <IconComponent size={14} />
                  </div>
                );
              }
              // Fallback to emoji for backwards compatibility
              return <span className="text-base">{icon}</span>;
            })()}
            <div className="text-sm font-semibold text-gray-900">
              {title}
            </div>
          </div>
          <div className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {countLabel}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-2 min-h-[260px] space-y-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm ${
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
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a card…"
            data-column-input={id}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
          />
        </form>
      </div>
    </div>
  );
}
