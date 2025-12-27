import React from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Card, Tag } from "../app/types";
import { RelationshipIndicators } from "./RelationshipPicker";

export function CardItem({
  card,
  onOpen,
  cardRefSetter,
  focused = false,
  allTags = [],
}: {
  card: Card;
  onOpen: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
  focused?: boolean;
  allTags?: Tag[];
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
      className={`group rounded-xl border bg-white px-3 py-2 text-sm text-emerald-950 shadow-[0_10px_30px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-emerald-700/20 hover:bg-emerald-50/50 ${
        focused
          ? "border-emerald-500 ring-2 ring-emerald-400/50"
          : "border-emerald-700/10"
      }`}
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
          {card.tags!.slice(0, 3).map((tagId) => {
            const tag = allTags.find((t) => t.id === tagId);
            if (tag) {
              return (
                <span
                  key={tagId}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
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
            }
            // Fallback for tags not in the system (e.g., old string tags)
            return (
              <span
                key={tagId}
                className="rounded-full border border-emerald-700/10 bg-emerald-50/60 px-2 py-0.5 text-[11px] text-emerald-900"
              >
                {tagId}
              </span>
            );
          })}
          {(card.tags?.length ?? 0) > 3 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
              +{card.tags!.length - 3}
            </span>
          )}
        </div>
      )}

      {card.blockedReason && (
        <div className="mt-2 text-[11px] text-rose-700/80">
          Blocked: {card.blockedReason}
        </div>
      )}

      {card.relations && card.relations.length > 0 && (
        <div className="mt-2">
          <RelationshipIndicators card={card} />
        </div>
      )}
    </div>
  );
}
