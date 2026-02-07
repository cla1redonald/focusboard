import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Calendar, ExternalLink } from "lucide-react";
import type { Card, CardLink } from "../app/types";
import { RelationshipIndicators } from "./RelationshipPicker";
import { getCardAgeLevel, getCardAgeDays } from "../app/metrics";
import { getUrgencyLevel, getUrgencyColor, getUrgencyLabel, getUrgencyBackgroundColor } from "../app/urgency";
import { getSafeUrl } from "../app/utils";

export const CardItem = React.memo(function CardItem({
  card,
  onOpen,
  cardRefSetter,
  focused = false,
  showAgingIndicator = false,
  showUrgencyIndicator = false,
  isStaleBacklog = false,
  staleBacklogDays = 0,
  reducedMotion: _reducedMotion = false,
}: {
  card: Card;
  onOpen: (card: Card) => void;
  cardRefSetter?: (id: string, el: HTMLElement | null) => void;
  focused?: boolean;
  showAgingIndicator?: boolean;
  showUrgencyIndicator?: boolean;
  isStaleBacklog?: boolean;
  staleBacklogDays?: number;
  reducedMotion?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { cardId: card.id, column: card.column },
    });

  const refFn = (el: HTMLElement | null) => {
    setNodeRef(el);
    cardRefSetter?.(card.id, el);
  };

  const hasBackground = !!card.backgroundImage;
  const urgencyLevel = getUrgencyLevel(card);
  const urgencyBgColor = getUrgencyBackgroundColor(urgencyLevel);

  const cardStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : undefined,
    ...(urgencyBgColor && !hasBackground ? { backgroundColor: urgencyBgColor } : {}),
  };

  return (
    <div
      ref={refFn}
      style={cardStyle}
      onClick={() => onOpen(card)}
      {...listeners}
      {...attributes}
      className={`group relative cursor-grab overflow-hidden rounded-xl border shadow-sm transition-shadow duration-150 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-100 active:cursor-grabbing dark:hover:shadow-emerald-900/20 ${
        focused
          ? "border-emerald-500 ring-2 ring-emerald-500/20"
          : "border-gray-200 hover:border-emerald-200 dark:border-gray-700 dark:hover:border-emerald-600"
      } ${hasBackground ? "" : urgencyBgColor ? "hover:brightness-95" : "bg-white dark:bg-gray-800"}`}
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
      <div className={`relative px-3 py-2.5 text-sm ${hasBackground ? "text-white" : "text-gray-900 dark:text-gray-100"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className={`text-left font-medium leading-snug ${hasBackground ? "text-white" : "text-gray-900 dark:text-white"}`}>
            <span className="inline-flex items-center gap-2">
              {card.icon && <span className="text-base">{card.icon}</span>}
              <span>{card.title}</span>
              {showAgingIndicator && (() => {
                const ageLevel = getCardAgeLevel(card);
                if (ageLevel === "none") return null;
                const ageDays = getCardAgeDays(card);
                const colors = {
                  yellow: "bg-gray-400",
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
            className={`select-none opacity-0 transition-opacity group-hover:opacity-100 ${hasBackground ? "text-white/50" : "text-gray-400 dark:text-gray-500"}`}
            title="Drag to move"
          >
            <GripVertical size={16} />
          </div>
        </div>

        {/* Due date display */}
        {card.dueDate && (() => {
          const urgencyColor = urgencyLevel !== "none" ? getUrgencyColor(urgencyLevel) : (hasBackground ? "white" : "#71717a");
          const dueDate = new Date(card.dueDate);
          const today = new Date();
          const isThisYear = dueDate.getFullYear() === today.getFullYear();
          const dateStr = dueDate.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            ...(isThisYear ? {} : { year: "numeric" }),
          });
          return (
            <div className="mt-2 flex items-center gap-1.5">
              <Calendar
                size={12}
                style={{ color: urgencyColor }}
              />
              <span
                className="text-[11px] font-medium"
                style={{ color: hasBackground ? "white" : urgencyColor }}
              >
                {dateStr}
                {urgencyLevel !== "none" && showUrgencyIndicator && (
                  <span className="ml-1 opacity-80">
                    ({getUrgencyLabel(urgencyLevel)})
                  </span>
                )}
              </span>
            </div>
          );
        })()}

        {/* Stale backlog warning */}
        {isStaleBacklog && (
          <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${
            hasBackground ? "text-gray-300" : "text-gray-600 dark:text-gray-400"
          }`}>
            <span>⚠️</span>
            <span>Stale ({staleBacklogDays} days)</span>
          </div>
        )}

        {card.blockedReason && (
          <div className={`mt-2 text-[11px] ${hasBackground ? "text-rose-300" : "text-red-600"}`}>
            Blocked: {card.blockedReason}
          </div>
        )}

        {card.relations && card.relations.length > 0 && (
          <div className="mt-2">
            <RelationshipIndicators card={card} />
          </div>
        )}

        {/* Links - clickable hyperlinks (supports multiple links) */}
        {(() => {
          const getLinkInfo = (url: string, customLabel?: string) => {
            if (customLabel) return { label: customLabel, icon: "🔗" };
            if (url.includes("drive.google.com")) return { label: "Google Drive", icon: "📁" };
            if (url.includes("docs.google.com")) return { label: "Google Docs", icon: "📄" };
            if (url.includes("sheets.google.com")) return { label: "Google Sheets", icon: "📊" };
            if (url.includes("figma.com")) return { label: "Figma", icon: "🎨" };
            if (url.includes("notion.")) return { label: "Notion", icon: "📝" };
            if (url.includes("github.com")) return { label: "GitHub", icon: "🐙" };
            if (url.includes("linear.app")) return { label: "Linear", icon: "📋" };
            if (url.includes("slack.com")) return { label: "Slack", icon: "💬" };
            if (url.includes("youtube.com") || url.includes("youtu.be")) return { label: "YouTube", icon: "▶️" };
            try {
              const hostname = new URL(url).hostname.replace("www.", "");
              return { label: hostname, icon: "🔗" };
            } catch {
              return { label: "Link", icon: "🔗" };
            }
          };

          // Collect all links: from new links array + legacy link field
          const allLinks: CardLink[] = [];
          if (card.links?.length) {
            allLinks.push(...card.links);
          } else if (card.link) {
            // Fallback to legacy single link
            allLinks.push({ id: "legacy", url: card.link });
          }

          // Filter to only safe URLs
          const safeLinks = allLinks
            .map((link) => ({ ...link, safeUrl: getSafeUrl(link.url) }))
            .filter((link): link is typeof link & { safeUrl: string } => Boolean(link.safeUrl));

          if (safeLinks.length === 0) return null;

          return (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {safeLinks.slice(0, 3).map((link) => {
                const { label, icon } = getLinkInfo(link.safeUrl, link.label);
                return (
                  <a
                    key={link.id}
                    href={link.safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition hover:underline ${
                      hasBackground
                        ? "bg-white/20 text-white hover:bg-white/30"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                    }`}
                    title={link.safeUrl}
                  >
                    <span>{icon}</span>
                    <span className="max-w-[100px] truncate">{label}</span>
                    <ExternalLink size={10} className="opacity-60" />
                  </a>
                );
              })}
              {safeLinks.length > 3 && (
                <span className={`inline-flex items-center px-2 py-1 text-[11px] ${
                  hasBackground ? "text-white/70" : "text-gray-500 dark:text-gray-400"
                }`}>
                  +{safeLinks.length - 3} more
                </span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
});
