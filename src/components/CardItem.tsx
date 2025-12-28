import React from "react";
import { motion } from "framer-motion";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card, Tag } from "../app/types";
import { RelationshipIndicators } from "./RelationshipPicker";
import { getCardAgeLevel, getCardAgeDays } from "../app/metrics";

export function CardItem({
  card,
  onOpen,
  cardRefSetter,
  focused = false,
  allTags = [],
  showAgingIndicator = false,
  reducedMotion = false,
}: {
  card: Card;
  onOpen: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
  focused?: boolean;
  allTags?: Tag[];
  showAgingIndicator?: boolean;
  reducedMotion?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { cardId: card.id, column: card.column },
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
  };

  const refFn = (el: HTMLElement | null) => {
    setNodeRef(el);
    cardRefSetter?.(card.id, el);
  };

  const hasBackground = !!card.backgroundImage;

  return (
    <motion.div
      ref={refFn}
      style={style}
      layout={!reducedMotion}
      initial={reducedMotion ? false : { opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0, scale: 0.95 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
      onClick={() => onOpen(card)}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border shadow-[0_10px_30px_rgba(0,0,0,0.08)] transition hover:-translate-y-0.5 hover:border-amber-700/20 ${
        focused
          ? "border-amber-500 ring-2 ring-amber-400/50"
          : "border-amber-700/10"
      } ${hasBackground ? "" : "bg-white hover:bg-amber-50/50"}`}
    >
      {/* Background Image */}
      {hasBackground && (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${card.backgroundImage})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />
        </>
      )}

      {/* Card Content */}
      <div className={`relative px-3 py-2 text-sm ${hasBackground ? "text-white" : "text-amber-950"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className={`text-left font-medium leading-snug ${hasBackground ? "text-white" : "text-amber-950"}`}>
            <span className="inline-flex items-center gap-2">
              {card.icon && <span className="text-base">{card.icon}</span>}
              <span>{card.title}</span>
              {showAgingIndicator && (() => {
                const ageLevel = getCardAgeLevel(card);
                if (ageLevel === "none") return null;
                const ageDays = getCardAgeDays(card);
                const colors = {
                  yellow: "bg-amber-400",
                  orange: "bg-orange-500",
                  red: "bg-rose-500",
                };
                return (
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${colors[ageLevel]}`}
                    title={`${ageDays} days since last update`}
                  />
                );
              })()}
            </span>
          </div>
          <div
            className={`cursor-grab select-none ${hasBackground ? "text-white/60 group-hover:text-white" : "text-amber-900/40 group-hover:text-amber-900/70"}`}
            title="Drag"
            onClick={(e) => e.stopPropagation()}
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
                      backgroundColor: hasBackground ? "rgba(255,255,255,0.25)" : `${tag.color}20`,
                      color: hasBackground ? "white" : tag.color,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: hasBackground ? "white" : tag.color }}
                    />
                    {tag.name}
                  </span>
                );
              }
              // Fallback for tags not in the system (e.g., old string tags)
              return (
                <span
                  key={tagId}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    hasBackground
                      ? "bg-white/20 text-white"
                      : "border border-amber-700/10 bg-amber-50/60 text-amber-900"
                  }`}
                >
                  {tagId}
                </span>
              );
            })}
            {(card.tags?.length ?? 0) > 3 && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                hasBackground ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
              }`}>
                +{card.tags!.length - 3}
              </span>
            )}
          </div>
        )}

        {card.blockedReason && (
          <div className={`mt-2 text-[11px] ${hasBackground ? "text-rose-300" : "text-rose-700/80"}`}>
            Blocked: {card.blockedReason}
          </div>
        )}

        {card.relations && card.relations.length > 0 && (
          <div className="mt-2">
            <RelationshipIndicators card={card} />
          </div>
        )}

        {/* Quick link button */}
        {card.link && (
          <a
            href={card.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition hover:scale-105 ${
              hasBackground
                ? "bg-white/20 text-white hover:bg-white/30"
                : "bg-amber-100 text-amber-700 hover:bg-amber-200"
            }`}
            title={card.link}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {card.link.includes("drive.google.com") ? "Google Drive" :
             card.link.includes("docs.google.com") ? "Google Docs" :
             card.link.includes("sheets.google.com") ? "Google Sheets" :
             card.link.includes("figma.com") ? "Figma" :
             card.link.includes("notion.") ? "Notion" :
             card.link.includes("github.com") ? "GitHub" :
             "Open link"}
          </a>
        )}
      </div>
    </motion.div>
  );
}
