import React from "react";
import { DndContext } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Card, Column as ColumnType, ColumnId, FilterState, MetricsState, Settings, Tag } from "../app/types";
import { CONFETTI_COLORS } from "../app/constants";
import { groupByColumn, isToday, nowIso } from "../app/utils";
import { DEFAULT_FILTER, filterCards, getAllTags } from "../app/filters";
import { useKeyboardNav } from "../app/useKeyboardNav";
import { Column } from "./Column";
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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  cards: Card[];
  columns: ColumnType[];
  settings: Settings;
  metrics: MetricsState;
  tagDefinitions?: Tag[];
  onAdd: (column: ColumnId, title: string) => void;
  onMove: (id: string, to: ColumnId, patch?: Partial<Card>) => void;
  onDelete: (id: string) => void;
  onOpenCard: (card: Card) => void;
  onSettings: () => void;
  onOpenMetrics: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion() || settings.reducedMotionOverride;
  const [filter, setFilter] = React.useState<FilterState>(DEFAULT_FILTER);

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

  // Sort columns by order
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  // Apply filters
  const filteredCards = filterCards(cards, filter);
  const allTags = getAllTags(cards);
  const byCol = groupByColumn(filteredCards, columns);

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
    const limit = wipLimit(colId);
    if (!limit) return "normal";
    const count = byCol[colId]?.length ?? 0;
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

  const pendingRef = React.useRef<{ id: string; from: ColumnId; to: ColumnId } | null>(null);

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

  const onDragEnd = (e: DragEndEvent) => {
    const cardId = String(e.active.id);
    const to = e.over?.id as ColumnId | undefined;
    if (!to) return;

    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const from = card.column;

    if (from === to) return;

    // guardrail: Design -> Doing disallowed
    if (!canMoveDirect(from, to)) {
      openWipModal(cardId, from, to, false);
      pendingRef.current = null;
      return;
    }

    // blocked reason required
    if (to === "blocked") {
      pendingRef.current = { id: cardId, from, to };
      openBlockedReasonModal(cardId, from, to);
      return;
    }

    // WIP checks
    if (wouldExceedWip(to)) {
      const toCol = getColumn(to);
      // Hard limit for "doing" column (WIP limit of 1)
      const allowOverride = !(toCol?.wipLimit === 1);
      pendingRef.current = { id: cardId, from, to };
      openWipModal(cardId, from, to, allowOverride);
      return;
    }

    // apply move
    onMove(cardId, to);
    if (reducedMotion) {
      if (isTerminalColumn(to)) pulseDoneHeader();
    } else {
      fireCelebrationIfNeeded(cardId, from, to);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <TopStrip
        doingCard={doingCard}
        blockedCount={blockedCount}
        dueTodayCount={dueTodayCount}
        metrics={metrics}
        onOpenMetrics={onOpenMetrics}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="display-font text-3xl text-emerald-950">Focusboard</div>
          <div className="text-sm text-emerald-900/70">
            Plan with intent. Keep flow sacred.
          </div>
        </div>
        <button
          onClick={onSettings}
          aria-label="Settings"
          className="rounded-full border border-emerald-700/20 bg-emerald-600/10 px-4 py-2 text-sm text-emerald-900 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:border-emerald-700/40 hover:bg-emerald-600/15"
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

      <DndContext onDragEnd={onDragEnd}>
        <div className="flex gap-5 overflow-x-auto pb-6">
          {sortedColumns.map((col, colIdx) => {
            const isColumnFocused = isNavigating && focusPosition?.columnIndex === colIdx;
            return (
              <div key={col.id}>
                <div
                  id={col.isTerminal ? `${col.id}-header` : undefined}
                  className="rounded-xl"
                >
                  <Column
                    id={col.id}
                    title={col.title}
                    cards={byCol[col.id] ?? []}
                    accentColor={col.color}
                    icon={col.icon}
                    countLabel={countLabel(col.id)}
                    headerState={headerState(col.id)}
                    onAdd={onAdd}
                    onOpenCard={onOpenCard}
                    cardRefSetter={setCardEl}
                    columnFocused={isColumnFocused}
                    focusedCardIndex={isColumnFocused ? focusPosition?.cardIndex ?? null : null}
                    allTags={tagDefinitions}
                  />
                </div>
              </div>
            );
          })}
        </div>
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
            : getColumn(modal?.to ?? "")?.wipLimit === 1
            ? "Doing is hard-limited to 1. Move the current Doing item out first."
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

          if (getColumn(modal.to)?.wipLimit === 1) {
            setModal(null);
            pendingRef.current = null;
            return;
          }

          // override move
          onMove(pending.id, pending.to, {
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
          onMove(pending.id, "blocked", { blockedReason: reason });
          setModal(null);
          pendingRef.current = null;
        }}
        confirmText="Save"
      />
    </div>
  );
}
