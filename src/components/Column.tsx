import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Card, ColumnId } from "../app/types";
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
      ? "border-rose-500/70 bg-rose-500/10"
      : headerState === "near"
      ? "border-amber-400/60 bg-amber-500/10"
      : "border-white/10 bg-white/5";

  return (
    <div className="w-[320px] shrink-0">
      <div
        className={`relative overflow-hidden rounded-2xl border ${headerClass} px-4 py-3`}
        style={{ boxShadow: accentGlow }}
      >
        <div className="absolute inset-0" style={{ backgroundImage: accentGradient }} />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
            <div className="display-font text-sm font-semibold text-zinc-100">
              {icon && <span className="mr-1.5">{icon}</span>}
              {title}
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-black/30 px-2.5 py-0.5 text-xs text-zinc-300">
            {countLabel}
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 min-h-[260px] space-y-3 rounded-2xl border border-white/10 bg-black/40 p-3 backdrop-blur ${
          isOver ? "ring-2 ring-emerald-400/40" : ""
        }`}
      >
        {cards.map((c) => (
          <CardItem
            key={c.id}
            card={c}
            onOpen={onOpenCard}
            cardRefSetter={cardRefSetter}
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
            className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-white/30 focus:bg-black/70"
          />
        </form>
      </div>
    </div>
  );
}
