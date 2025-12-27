import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Card, ColumnId, Tag } from "../app/types";
import { CardItem } from "./CardItem";

const hexToRgb = (hex: string) => {
  const cleaned = hex.replace("#", "").trim();
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
};

export function Column({
  id,
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
  allTags = [],
}: {
  id: ColumnId;
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
  allTags?: Tag[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const accentRgb = hexToRgb(accentColor);
  const accentGlow = accentRgb
    ? `0 0 26px rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.28)`
    : undefined;
  const accentGradient = accentRgb
    ? `linear-gradient(135deg, rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.35), rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.12) 45%, transparent 85%)`
    : undefined;

  const [text, setText] = React.useState("");

  const headerClass =
    headerState === "full"
      ? "border-rose-400/60 bg-rose-200/30"
      : headerState === "near"
      ? "border-amber-300/50 bg-amber-100/40"
      : "border-emerald-700/10 bg-white/70";

  const headerFocusClass =
    columnFocused && focusedCardIndex === null
      ? "ring-2 ring-emerald-400/50"
      : "";

  return (
    <div className="w-[320px] shrink-0">
      <div
        className={`relative overflow-hidden rounded-2xl border ${headerClass} ${headerFocusClass} px-4 py-3`}
        style={{ boxShadow: accentGlow }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: accentGradient }} />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
            <div className="display-font text-sm font-semibold text-emerald-950">
              {icon && <span className="mr-1.5">{icon}</span>}
              {title}
            </div>
          </div>
          <div className="rounded-full border border-emerald-700/15 bg-white/80 px-2.5 py-0.5 text-xs text-emerald-900/70">
            {countLabel}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 min-h-[260px] space-y-3 rounded-2xl border border-emerald-700/10 bg-white/70 p-3 backdrop-blur ${
          isOver ? "ring-2 ring-emerald-300/40" : ""
        }`}
      >
        {cards.map((c, idx) => (
          <CardItem
            key={c.id}
            card={c}
            onOpen={onOpenCard}
            cardRefSetter={cardRefSetter}
            focused={columnFocused && focusedCardIndex === idx}
            allTags={allTags}
          />
        ))}

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
            className="w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-900 outline-none transition focus:border-emerald-700/30 focus:bg-emerald-50/40"
          />
        </form>
      </div>
    </div>
  );
}
