import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, Column as ColumnType, ColumnId, SwimlaneId } from "../app/types";
import { Column } from "./Column";

type SwimlaneProps = {
  swimlaneId: SwimlaneId;
  title: string;
  icon: string;
  color: string;
  columns: ColumnType[];
  cardsByColumn: Record<ColumnId, Card[]>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAdd: (column: ColumnId, title: string, swimlane: SwimlaneId) => void;
  onOpenCard: (card: Card) => void;
  cardRefSetter: (id: string, el: HTMLElement | null) => void;
  columnFocused: boolean;
  focusedColumnIndex: number | null;
  focusedCardIndex: number | null;
  showAgingIndicators: boolean;
  showUrgencyIndicators: boolean;
  staleCardIds: Set<string>;
  staleCardDays: Record<string, number>;
  reducedMotion: boolean;
  countLabel: (colId: ColumnId) => string;
  headerState: (colId: ColumnId) => "normal" | "near" | "full";
  onReorderCards: (columnId: ColumnId, cardIds: string[], swimlane: SwimlaneId) => void;
};

export function Swimlane({
  swimlaneId,
  title,
  icon,
  color,
  columns,
  cardsByColumn,
  collapsed,
  onToggleCollapse,
  onAdd,
  onOpenCard,
  cardRefSetter,
  columnFocused,
  focusedColumnIndex,
  focusedCardIndex,
  showAgingIndicators,
  showUrgencyIndicators,
  staleCardIds,
  staleCardDays,
  reducedMotion,
  countLabel,
  headerState,
  onReorderCards: _onReorderCards,
}: SwimlaneProps) {
  void _onReorderCards; // Will be used for reordering within swimlane
  const cardCount = Object.values(cardsByColumn).flat().length;

  return (
    <div className="swimlane mb-6 border-b border-amber-200 pb-6 last:border-b-0 last:pb-0">
      {/* Swimlane Header - Always visible */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-3 mb-3 w-full text-left group hover:bg-amber-50/50 rounded-lg px-2 py-1.5 -mx-2 transition"
      >
        <span
          className="flex items-center justify-center w-8 h-8 rounded-lg text-lg"
          style={{ backgroundColor: `${color}20` }}
        >
          {icon}
        </span>
        <span className="text-lg font-semibold text-amber-950">{title}</span>
        <span className="text-sm text-amber-900/60">({cardCount} cards)</span>
        <span className="ml-auto text-amber-900/40 transition group-hover:text-amber-900/70 text-sm">
          {collapsed ? "+" : "-"}
        </span>
      </button>

      {/* Collapsible Content */}
      {!collapsed && (
        <div className="flex gap-3 overflow-x-auto pb-4 sm:gap-5">
          <SortableContext
            items={columns.map((col) => `${swimlaneId}:${col.id}`)}
            strategy={horizontalListSortingStrategy}
          >
            {columns.map((col, colIdx) => {
              const isColFocused = columnFocused && focusedColumnIndex === colIdx;
              return (
                <Column
                  key={`${swimlaneId}-${col.id}`}
                  id={col.id}
                  swimlaneId={swimlaneId}
                  title={col.title}
                  cards={cardsByColumn[col.id] ?? []}
                  accentColor={col.color}
                  icon={col.icon}
                  countLabel={countLabel(col.id)}
                  headerState={headerState(col.id)}
                  onAdd={(colId, cardTitle) => onAdd(colId, cardTitle, swimlaneId)}
                  onOpenCard={onOpenCard}
                  cardRefSetter={cardRefSetter}
                  columnFocused={isColFocused}
                  focusedCardIndex={isColFocused ? focusedCardIndex : null}
                  showAgingIndicators={showAgingIndicators}
                  showUrgencyIndicators={showUrgencyIndicators}
                  staleCardIds={staleCardIds}
                  staleCardDays={staleCardDays}
                  reducedMotion={reducedMotion}
                />
              );
            })}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
