import React from "react";
import { DndContext, DragOverlay, PointerSensor, useSensors, useSensor } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Card, Column as ColumnType, ColumnId, FilterState, MetricsState, Settings, SwimlaneId, Tag } from "../app/types";
import { CONFETTI_COLORS, DEFAULT_SWIMLANES } from "../app/constants";
import { groupBySwimlaneAndColumn, isToday, nowIso } from "../app/utils";
import { DEFAULT_FILTER, filterCards, getAllTags } from "../app/filters";
import { getStaleBacklogCards } from "../app/metrics";
import { useKeyboardNav } from "../app/useKeyboardNav";
import { useTheme } from "../app/theme";
import { Swimlane } from "./Swimlane";
import { TopStrip } from "./TopStrip";
import { FilterBar } from "./FilterBar";
import { WipModal } from "./WipModal";
import { ConfettiBurst } from "./ConfettiBurst";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function Board({
  cards,
  columns,
  settings,
  metrics,
  tagDefinitions = [],
  onAdd,
  onMove,
  onDelete,
  onOpenCard,
  onSettings,
  onOpenMetrics,
  onOpenTimeline,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReorderCards,
  onToggleSwimlaneCollapse,
}: {
  cards: Card[];
  columns: ColumnType[];
  settings: Settings;
  metrics: MetricsState;
  tagDefinitions?: Tag[];
  onAdd: (column: ColumnId, title: string, swimlane?: SwimlaneId) => void;
  onMove: (id: string, to: ColumnId, toSwimlane?: SwimlaneId, patch?: Partial<Card>) => void;
  onDelete: (id: string) => void;
  onOpenCard: (card: Card) => void;
  onSettings: () => void;
  onOpenMetrics: () => void;
  onOpenTimeline: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReorderCards: (columnId: ColumnId, cardIds: string[], swimlane?: SwimlaneId) => void;
  onToggleSwimlaneCollapse: (swimlaneId: SwimlaneId) => void;
}) {
  const reducedMotion = usePrefersReducedMotion() || settings.reducedMotionOverride;

  // Apply theme to document root
  useTheme(settings.theme);

  const [filter, setFilter] = React.useState<FilterState>(DEFAULT_FILTER);

  // Configure sensors with distance constraint to prevent accidental drags
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // modal state (declared early for keyboard nav)
  const [modal, setModal] = React.useState<
    | null
    | {
        kind: "wip" | "blocked";
        cardId: string;
        from: ColumnId;
        to: ColumnId;
        allowOverride: boolean;
      }
  >(null);

  // Active dragging card for DragOverlay
  const [activeCard, setActiveCard] = React.useState<Card | null>(null);

  // Scroll indicator state
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = React.useState(false);

  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkScroll = () => {
      const hasMoreContent = container.scrollHeight > container.clientHeight;
      const isNotAtBottom = container.scrollTop < container.scrollHeight - container.clientHeight - 20;
      setCanScrollDown(hasMoreContent && isNotAtBottom);
    };

    checkScroll();
    container.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);

    // Re-check when swimlanes collapse/expand
    const observer = new MutationObserver(checkScroll);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      container.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      observer.disconnect();
    };
  }, []);

  // Sort columns by order
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  // Apply filters
  const filteredCards = filterCards(cards, filter);
  const allTags = getAllTags(cards);
  const bySwimlaneAndCol = groupBySwimlaneAndColumn(filteredCards, columns);

  // Flat byCol for WIP calculations (counts all cards regardless of swimlane)
  const byCol: Record<ColumnId, Card[]> = {};
  for (const col of columns) {
    byCol[col.id] = [
      ...(bySwimlaneAndCol.work[col.id] ?? []),
      ...(bySwimlaneAndCol.personal[col.id] ?? []),
    ];
  }

  // Keyboard navigation
  const { focusPosition, isNavigating } = useKeyboardNav({
    columns: sortedColumns,
    cardsByColumn: byCol,
    onOpenCard,
    onDeleteCard: onDelete,
    onAddCard: (columnId) => {
      // Focus the add input for the column
      const input = document.querySelector(`[data-column-input="${columnId}"]`) as HTMLInputElement;
      input?.focus();
    },
    enabled: !modal, // Disable when modal is open
  });

  const doingCol = sortedColumns.find((c) => c.id === "doing");
  const doingCard = doingCol ? byCol[doingCol.id]?.[0] : undefined;
  const blockedCol = sortedColumns.find((c) => c.id === "blocked");
  const blockedCount = blockedCol ? byCol[blockedCol.id]?.length ?? 0 : 0;
  const dueTodayCount = cards.filter((c) => isToday(c.dueDate)).length;

  // Calculate stale backlog cards
  const staleData = React.useMemo(() => {
    const staleCards = getStaleBacklogCards(cards, columns, settings.staleBacklogThreshold);
    const staleCardIds = new Set(staleCards.map((s) => s.card.id));
    const staleCardDays: Record<string, number> = {};
    for (const s of staleCards) {
      staleCardDays[s.card.id] = s.daysSinceUpdate;
    }
    return { staleCardIds, staleCardDays };
  }, [cards, columns, settings.staleBacklogThreshold]);

  const getColumn = (id: ColumnId): ColumnType | undefined =>
    columns.find((c) => c.id === id);

  const wipLimit = (colId: ColumnId): number | null => {
    const col = getColumn(colId);
    return col?.wipLimit ?? null;
  };

  const countLabel = (colId: ColumnId) => {
    const limit = wipLimit(colId);
    const count = byCol[colId]?.length ?? 0;
    if (!limit) return String(count);
    return `${count}/${limit}`;
  };

  const headerState = (colId: ColumnId): "normal" | "near" | "full" => {
    const count = byCol[colId]?.length ?? 0;

    // Special handling for "doing" column - warn at 3+
    if (colId === "doing") {
      if (count >= 3) return "full";
      if (count >= 2) return "near";
      return "normal";
    }

    // Standard WIP limit logic for other columns
    const limit = wipLimit(colId);
    if (!limit) return "normal";
    if (count >= limit) return "full";
    if (count / limit >= 0.8) return "near";
    return "normal";
  };

  // card element refs to locate confetti origin
  const cardEls = React.useRef(new Map<string, HTMLElement>());
  const setCardEl = (id: string, el: HTMLElement | null) => {
    if (!el) cardEls.current.delete(id);
    else cardEls.current.set(id, el);
  };

  // celebration state
  const [confetti, setConfetti] = React.useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const lastCelebrateRef = React.useRef<number>(0);

  const pendingRef = React.useRef<{ id: string; from: ColumnId; to: ColumnId; fromSwimlane?: SwimlaneId; toSwimlane?: SwimlaneId } | null>(null);

  const openWipModal = (cardId: string, from: ColumnId, to: ColumnId, allowOverride: boolean) => {
    setModal({ kind: "wip", cardId, from, to, allowOverride });
  };

  const openBlockedReasonModal = (cardId: string, from: ColumnId, to: ColumnId) => {
    setModal({ kind: "blocked", cardId, from, to, allowOverride: false });
  };

  const isTerminalColumn = (colId: ColumnId): boolean => {
    const col = getColumn(colId);
    return col?.isTerminal ?? false;
  };

  const fireCelebrationIfNeeded = (cardId: string, _from: ColumnId, to: ColumnId) => {
    if (reducedMotion) return;
    if (!settings.celebrations) return;
    // Fire celebration when moving to a terminal column (like "done")
    if (!isTerminalColumn(to)) return;

    const now = Date.now();
    if (now - lastCelebrateRef.current < 2000) return;
    lastCelebrateRef.current = now;

    const el = cardEls.current.get(cardId);
    const rect = el?.getBoundingClientRect();
    const x = rect ? rect.right - 12 : window.innerWidth / 2;
    const y = rect ? rect.top + 12 : window.innerHeight / 3;

    setConfetti({ x, y, active: true });
    window.setTimeout(() => setConfetti((c) => ({ ...c, active: false })), 700);
  };

  const pulseDoneHeader = () => {
    // Find terminal column to pulse
    const terminalCol = sortedColumns.find((c) => c.isTerminal);
    if (!terminalCol) return;
    const el = document.getElementById(`${terminalCol.id}-header`);
    if (!el) return;
    el.classList.remove("animate-pulse");
    void el.offsetWidth;
    el.classList.add("animate-pulse");
    window.setTimeout(() => el.classList.remove("animate-pulse"), 220);
  };

  const canMoveDirect = (from: ColumnId, to: ColumnId) => {
    // Block Design -> Doing direct moves (must go through Todo)
    if (from === "design" && to === "doing") return false;
    return true;
  };

  const wouldExceedWip = (to: ColumnId) => {
    const limit = wipLimit(to);
    if (!limit) return false;
    return (byCol[to]?.length ?? 0) + 1 > limit;
  };

  // Parse composite droppable ID (format: "swimlaneId:columnId" or just "columnId")
  const parseDroppableId = (id: string): { swimlaneId?: SwimlaneId; columnId: ColumnId } => {
    if (id.includes(":")) {
      const [swimlaneId, columnId] = id.split(":") as [SwimlaneId, ColumnId];
      return { swimlaneId, columnId };
    }
    return { columnId: id as ColumnId };
  };

  const onDragStart = (e: DragStartEvent) => {
    const cardId = String(e.active.id);
    const card = cards.find((c) => c.id === cardId);
    setActiveCard(card ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const cardId = String(e.active.id);
    const overId = e.over?.id as string | undefined;
    if (!overId) return;

    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const from = card.column;
    const fromSwimlane = card.swimlane ?? "work";

    // Check if we're dropping on another card (reorder) or on a column (move)
    const overCard = cards.find((c) => c.id === overId);

    // Parse the overId to get swimlane and column info
    const { swimlaneId: toSwimlane, columnId: toColumn } = parseDroppableId(overId);

    // If dropping on a card in the same column and same swimlane, it's a reorder
    if (overCard && overCard.column === from && (overCard.swimlane ?? "work") === fromSwimlane) {
      const columnCards = bySwimlaneAndCol[fromSwimlane][from] ?? [];
      const oldIndex = columnCards.findIndex((c) => c.id === cardId);
      const newIndex = columnCards.findIndex((c) => c.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newOrder = arrayMove(columnCards, oldIndex, newIndex);
        onReorderCards(from, newOrder.map((c) => c.id), fromSwimlane);
      }
      return;
    }

    // Determine target column and swimlane
    const to: ColumnId = overCard ? overCard.column : toColumn;
    const targetSwimlane: SwimlaneId = overCard ? (overCard.swimlane ?? "work") : (toSwimlane ?? fromSwimlane);

    // If it's a no-op (same column AND same swimlane), return
    if (from === to && fromSwimlane === targetSwimlane) return;

    // guardrail: Design -> Doing disallowed
    if (!canMoveDirect(from, to)) {
      openWipModal(cardId, from, to, false);
      pendingRef.current = null;
      setActiveCard(null);
      return;
    }

    // blocked reason required
    if (to === "blocked") {
      pendingRef.current = { id: cardId, from, to, fromSwimlane, toSwimlane: targetSwimlane };
      openBlockedReasonModal(cardId, from, to);
      setActiveCard(null);
      return;
    }

    // WIP checks (allow override for all columns)
    if (wouldExceedWip(to)) {
      pendingRef.current = { id: cardId, from, to, fromSwimlane, toSwimlane: targetSwimlane };
      openWipModal(cardId, from, to, true);
      setActiveCard(null);
      return;
    }

    // apply move (include swimlane if changed)
    onMove(cardId, to, targetSwimlane);
    if (reducedMotion) {
      if (isTerminalColumn(to)) pulseDoneHeader();
    } else {
      fireCelebrationIfNeeded(cardId, from, to);
    }
    setActiveCard(null);
  };

  const onDragCancel = () => {
    setActiveCard(null);
  };

  return (
    <div className="h-full flex flex-col">
      <TopStrip
        doingCard={doingCard}
        blockedCount={blockedCount}
        dueTodayCount={dueTodayCount}
        metrics={metrics}
        onOpenMetrics={onOpenMetrics}
        onOpenTimeline={onOpenTimeline}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div>
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="FocusBoard" className="h-10 w-10 sm:h-12 sm:w-12" />
            <div>
              <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-3xl">
                FocusBoard
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {cards.filter(c => !columns.find(col => col.id === c.column)?.isTerminal).length === 0
                  ? "No tasks pending. Time to plan your next goal!"
                  : `${cards.filter(c => !columns.find(col => col.id === c.column)?.isTerminal).length} tasks in progress`}
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={onSettings}
          aria-label="Settings"
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:border-emerald-300 hover:text-emerald-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:border-emerald-600 dark:hover:text-emerald-400"
        >
          Settings
        </button>
      </div>

      <FilterBar
        filter={filter}
        onChange={setFilter}
        columns={sortedColumns}
        allTags={allTags}
        tagDefinitions={tagDefinitions}
        resultCount={filteredCards.length}
        totalCount={cards.length}
      />

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pb-6 relative">
          {DEFAULT_SWIMLANES.map((swimlane, swimlaneIdx) => {
            const isSwimlaneFocused = isNavigating && swimlaneIdx === 0; // TODO: multi-swimlane keyboard nav
            return (
              <Swimlane
                key={swimlane.id}
                swimlaneId={swimlane.id}
                title={swimlane.title}
                icon={swimlane.icon}
                color={swimlane.color}
                columns={sortedColumns}
                cardsByColumn={bySwimlaneAndCol[swimlane.id]}
                collapsed={settings.collapsedSwimlanes?.includes(swimlane.id) ?? false}
                onToggleCollapse={() => onToggleSwimlaneCollapse(swimlane.id)}
                onAdd={onAdd}
                onOpenCard={onOpenCard}
                cardRefSetter={setCardEl}
                columnFocused={isSwimlaneFocused}
                focusedColumnIndex={isSwimlaneFocused ? focusPosition?.columnIndex ?? null : null}
                focusedCardIndex={isSwimlaneFocused ? focusPosition?.cardIndex ?? null : null}
                showAgingIndicators={settings.showAgingIndicators}
                showUrgencyIndicators={true}
                staleCardIds={staleData.staleCardIds}
                staleCardDays={staleData.staleCardDays}
                reducedMotion={reducedMotion}
                countLabel={countLabel}
                headerState={headerState}
                onReorderCards={onReorderCards}
              />
            );
          })}
        </div>

        {/* Scroll indicator - shows when there's more content below */}
        {canScrollDown && (
          <div className="pointer-events-none sticky bottom-0 left-0 right-0 flex justify-center pb-2">
            <div className="flex flex-col items-center gap-1 rounded-full bg-emerald-500 px-4 py-2 text-white shadow-lg animate-bounce">
              <span className="text-xs font-medium">Scroll for more</span>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </div>
        )}

        {/* Drag overlay shows a preview of the card being dragged */}
        <DragOverlay>
          {activeCard && (
            <div className="w-[280px] rounded-xl border border-emerald-500 bg-white px-3 py-2.5 shadow-xl rotate-2 dark:bg-gray-800 dark:border-emerald-400">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                {activeCard.icon && <span className="text-base">{activeCard.icon}</span>}
                <span className="truncate">{activeCard.title}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ConfettiBurst x={confetti.x} y={confetti.y} colors={CONFETTI_COLORS} active={confetti.active} />

      <WipModal
        open={!!modal && modal.kind === "wip"}
        title={
          modal?.from === "design" && modal?.to === "doing"
            ? "Move not allowed"
            : "WIP limit reached"
        }
        message={
          modal?.from === "design" && modal?.to === "doing"
            ? "Cards must pass through To Do before moving into Doing."
            : "This column is at its WIP limit. Move something out first, or override with a reason."
        }
        askReason={!!modal && modal.kind === "wip" && modal.allowOverride}
        reasonLabel="Override reason"
        onCancel={() => setModal(null)}
        onConfirm={(reason) => {
          const pending = pendingRef.current;
          if (!pending || !modal) return;

          if (modal.from === "design" && modal.to === "doing") {
            setModal(null);
            pendingRef.current = null;
            return;
          }

          // override move
          onMove(pending.id, pending.to, pending.toSwimlane, {
            lastOverrideReason: reason,
            lastOverrideAt: nowIso(),
          });

          if (reducedMotion) {
            if (isTerminalColumn(pending.to)) pulseDoneHeader();
          } else {
            fireCelebrationIfNeeded(pending.id, pending.from, pending.to);
          }

          setModal(null);
          pendingRef.current = null;
        }}
        confirmText={modal?.allowOverride ? "Override" : "OK"}
      />

      <WipModal
        open={!!modal && modal.kind === "blocked"}
        title="Why is this blocked?"
        message="Add a one-line reason. You can edit it later in the card."
        askReason={true}
        reasonLabel="Blocked reason"
        onCancel={() => setModal(null)}
        onConfirm={(reason) => {
          const pending = pendingRef.current;
          if (!pending) return;
          onMove(pending.id, "blocked", pending.toSwimlane, { blockedReason: reason });
          setModal(null);
          pendingRef.current = null;
        }}
        confirmText="Save"
      />
    </div>
  );
}
