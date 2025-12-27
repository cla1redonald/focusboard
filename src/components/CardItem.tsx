import React from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Card } from "../app/types";

export function CardItem({
  card,
  onOpen,
  cardRefSetter,
}: {
  card: Card;
  onOpen: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      data: { cardId: card.id },
    });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.7 : 1,
  };

  const refFn = (el: HTMLElement | null) => {
    setNodeRef(el);
    cardRefSetter?.(card.id, el);
  };

  return (
    <div
      ref={refFn}
      style={style}
      className="group rounded-xl border border-emerald-700/10 bg-white px-3 py-2 text-sm text-emerald-950 shadow-[0_10px_30px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-emerald-700/20 hover:bg-emerald-50/50"
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onOpen(card)}
          className="text-left font-medium leading-snug text-emerald-950 hover:text-emerald-900"
        >
          <span className="inline-flex items-center gap-2">
            {card.icon && <span className="text-base">{card.icon}</span>}
            <span>{card.title}</span>
          </span>
        </button>
        <div
          className="cursor-grab select-none text-emerald-900/40 group-hover:text-emerald-900/70"
          title="Drag"
          {...listeners}
          {...attributes}
        >
          ⋮⋮
        </div>
      </div>

      {(card.tags?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags!.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded-full border border-emerald-700/10 bg-emerald-50/60 px-2 py-0.5 text-[11px] text-emerald-900"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {card.blockedReason && (
        <div className="mt-2 text-[11px] text-rose-700/80">
          Blocked: {card.blockedReason}
        </div>
      )}
    </div>
  );
}
