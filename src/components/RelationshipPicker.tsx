import type { Card, RelationType } from "../app/types";

const RELATION_LABELS: Record<RelationType, string> = {
  blocks: "Blocks",
  "blocked-by": "Blocked by",
  parent: "Parent of",
  child: "Child of",
  related: "Related to",
};

const RELATION_ICONS: Record<RelationType, string> = {
  blocks: "🚫",
  "blocked-by": "⛔",
  parent: "📦",
  child: "📄",
  related: "🔗",
};

export function RelationshipPicker({
  cards,
  currentCardId,
  onSelect,
  onCancel,
}: {
  cards: Card[];
  currentCardId: string;
  onSelect: (targetCardId: string, relationType: RelationType) => void;
  onCancel: () => void;
}) {
  const availableCards = cards.filter((c) => c.id !== currentCardId);

  if (availableCards.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <p>No other cards available to link.</p>
        <button
          onClick={onCancel}
          className="mt-3 text-emerald-600 hover:text-emerald-700"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <div className="mb-3 text-sm font-medium text-gray-900">Add Relationship</div>
      <div className="max-h-60 space-y-2 overflow-y-auto">
        {availableCards.map((card) => (
          <div
            key={card.id}
            className="rounded-lg border border-gray-200 bg-gray-50 p-2"
          >
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-900">
              {card.icon && <span>{card.icon}</span>}
              <span className="truncate">{card.title}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(["blocks", "blocked-by", "parent", "child", "related"] as RelationType[]).map(
                (type) => (
                  <button
                    key={type}
                    onClick={() => onSelect(card.id, type)}
                    className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 transition hover:bg-gray-200"
                    title={RELATION_LABELS[type]}
                  >
                    {RELATION_ICONS[type]} {RELATION_LABELS[type]}
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onCancel}
        className="mt-3 text-sm text-emerald-600 hover:text-emerald-700"
      >
        Cancel
      </button>
    </div>
  );
}

export function RelationshipBadge({
  relation,
  targetCard,
  onRemove,
  onClick,
}: {
  relation: { id: string; type: RelationType; targetCardId: string };
  targetCard: Card | undefined;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  if (!targetCard) return null;

  return (
    <div
      className="group flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs"
      onClick={onClick}
    >
      <span className="text-emerald-600">{RELATION_ICONS[relation.type]}</span>
      <span className="text-gray-600">{RELATION_LABELS[relation.type]}</span>
      <span className="truncate font-medium text-gray-900" title={targetCard.title}>
        {targetCard.title.slice(0, 20)}
        {targetCard.title.length > 20 && "..."}
      </span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 opacity-0 transition group-hover:opacity-100"
          title="Remove relationship"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-500 hover:text-red-500"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function RelationshipIndicators({
  card,
}: {
  card: Card;
}) {
  if (!card.relations || card.relations.length === 0) return null;

  const blockingCount = card.relations.filter((r) => r.type === "blocks").length;
  const blockedByCount = card.relations.filter((r) => r.type === "blocked-by").length;
  const parentCount = card.relations.filter((r) => r.type === "parent").length;
  const childCount = card.relations.filter((r) => r.type === "child").length;
  const relatedCount = card.relations.filter((r) => r.type === "related").length;

  return (
    <div className="flex flex-wrap gap-1">
      {blockingCount > 0 && (
        <span
          className="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700"
          title={`Blocks ${blockingCount} card${blockingCount > 1 ? "s" : ""}`}
        >
          🚫 {blockingCount}
        </span>
      )}
      {blockedByCount > 0 && (
        <span
          className="rounded bg-orange-100 px-1 py-0.5 text-[10px] text-orange-700"
          title={`Blocked by ${blockedByCount} card${blockedByCount > 1 ? "s" : ""}`}
        >
          ⛔ {blockedByCount}
        </span>
      )}
      {parentCount > 0 && (
        <span
          className="rounded bg-blue-100 px-1 py-0.5 text-[10px] text-blue-700"
          title={`Parent of ${parentCount} card${parentCount > 1 ? "s" : ""}`}
        >
          📦 {parentCount}
        </span>
      )}
      {childCount > 0 && (
        <span
          className="rounded bg-purple-100 px-1 py-0.5 text-[10px] text-purple-700"
          title={`Child of ${childCount} card${childCount > 1 ? "s" : ""}`}
        >
          📄 {childCount}
        </span>
      )}
      {relatedCount > 0 && (
        <span
          className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-700"
          title={`Related to ${relatedCount} card${relatedCount > 1 ? "s" : ""}`}
        >
          🔗 {relatedCount}
        </span>
      )}
    </div>
  );
}
