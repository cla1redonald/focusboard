import React from "react";
import type { Card, RelationType, Tag, TagCategory } from "../app/types";
import { nanoid } from "nanoid";
import { RelationshipPicker, RelationshipBadge } from "./RelationshipPicker";
import { TAG_COLOR_PALETTE } from "../app/constants";
import { UnsplashPicker } from "./UnsplashPicker";

// Extended emoji palette organized by category
const EMOJI_CHOICES = [
  // Status
  "✨", "✅", "⚡", "🔥", "🚧", "⛔", "🎯", "🔍",
  // Work
  "📝", "📌", "📎", "🛠️", "💡", "🧠", "🧩", "🎨",
  // Objects
  "📱", "💻", "📊", "📈", "🔗", "📧", "💬", "🔔",
  // Nature & Fun
  "⭐", "💎", "🌟", "🏆", "🎉", "💪", "🚀", "🌈",
];

type Props = {
  open: boolean;
  card: Card | null;
  allCards?: Card[];
  tags?: Tag[];
  tagCategories?: TagCategory[];
  onClose: () => void;
  onSave: (card: Card) => void;
  onDelete: (id: string) => void;
  onAddRelation?: (cardId: string, targetCardId: string, relationType: RelationType) => void;
  onRemoveRelation?: (cardId: string, relationId: string) => void;
  onAddTag?: (tag: Omit<Tag, "id">) => void;
};

export function CardModal({
  open,
  card,
  allCards,
  tags = [],
  tagCategories = [],
  onClose,
  onSave,
  onDelete,
  onAddRelation,
  onRemoveRelation,
  onAddTag,
}: Props) {
  const [draft, setDraft] = React.useState<Card | null>(card);
  const [showRelationPicker, setShowRelationPicker] = React.useState(false);
  const [showAddTag, setShowAddTag] = React.useState(false);
  const [newTagName, setNewTagName] = React.useState("");
  const [newTagColor, setNewTagColor] = React.useState(TAG_COLOR_PALETTE[0]);
  const [showUnsplashPicker, setShowUnsplashPicker] = React.useState(false);
  const emojiInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft(card);
    setShowRelationPicker(false);
    setShowAddTag(false);
    setNewTagName("");
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    setShowUnsplashPicker(false);
  }, [card]);

  if (!open || !draft) return null;

  const update = (patch: Partial<Card>) => setDraft({ ...draft, ...patch });

  const handleAddRelation = (targetCardId: string, relationType: RelationType) => {
    if (onAddRelation) {
      onAddRelation(draft.id, targetCardId, relationType);
    }
    setShowRelationPicker(false);
  };

  const handleRemoveRelation = (relationId: string) => {
    if (onRemoveRelation) {
      onRemoveRelation(draft.id, relationId);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-amber-950/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col rounded-2xl border border-amber-700/15 bg-white/95 shadow-[0_30px_90px_rgba(0,0,0,0.2)]">
        {/* Fixed Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-amber-700/10 px-4 py-3 sm:px-6 sm:py-4">
          <div className="display-font text-lg text-amber-950 sm:text-xl">Edit card</div>
          <button onClick={onClose} className="rounded-full p-1 text-amber-900/60 hover:bg-amber-100 hover:text-amber-900">✕</button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-amber-900/60">Title</label>
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-2 w-full rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
            />
          </div>

          <div>
            <label className="text-xs text-amber-900/60">Icon (emoji)</label>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={emojiInputRef}
                  value={draft.icon ?? ""}
                  onChange={(e) => update({ icon: e.target.value })}
                  placeholder="Type or paste emoji"
                  className="w-32 rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-center text-lg text-amber-950 outline-none focus:border-amber-700/30"
                />
                {draft.icon && (
                  <button
                    type="button"
                    onClick={() => update({ icon: undefined })}
                    className="rounded-lg border border-amber-700/15 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 hover:border-amber-700/30"
                  >
                    Clear
                  </button>
                )}
                <span className="text-[10px] text-amber-900/50">
                  Tip: Press {navigator.platform.includes("Mac") ? "⌘+Ctrl+Space" : "Win+."} for full emoji keyboard
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {EMOJI_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => update({ icon: emoji })}
                    className={`rounded-lg border px-2 py-1 text-base transition ${
                      draft.icon === emoji
                        ? "border-amber-500 bg-amber-100"
                        : "border-amber-700/15 bg-amber-50/70 hover:border-amber-700/30"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-amber-900/60">Notes</label>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              className="mt-2 w-full min-h-[90px] rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-amber-900/60">Link</label>
              <input
                value={draft.link ?? ""}
                onChange={(e) => update({ link: e.target.value })}
                className="mt-2 w-full rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
              />
            </div>
            <div>
              <label className="text-xs text-amber-900/60">Due date</label>
              <input
                type="date"
                value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
                onChange={(e) =>
                  update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                }
                className="mt-2 w-full rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
              />
            </div>
          </div>

          {/* Card Background */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-amber-900/60">Card Background</label>
              {draft.backgroundImage && (
                <button
                  type="button"
                  onClick={() => update({ backgroundImage: undefined })}
                  className="text-xs text-rose-600 hover:text-rose-700"
                >
                  Remove
                </button>
              )}
            </div>

            {draft.backgroundImage ? (
              <div className="mt-2">
                <div className="relative aspect-video w-full max-w-[200px] overflow-hidden rounded-lg border border-amber-700/15">
                  <img
                    src={draft.backgroundImage}
                    alt="Card background"
                    className="h-full w-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowUnsplashPicker(true)}
                  className="mt-2 text-xs text-amber-600 hover:text-amber-700"
                >
                  Change image
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowUnsplashPicker(true)}
                className="mt-2 rounded-lg border border-dashed border-amber-700/20 bg-amber-50/50 px-4 py-3 text-xs text-amber-900/70 hover:border-amber-700/30 hover:bg-amber-50"
              >
                + Add background image from Unsplash
              </button>
            )}

            {showUnsplashPicker && (
              <div className="mt-3">
                <UnsplashPicker
                  onSelect={(imageUrl) => {
                    update({ backgroundImage: imageUrl });
                    setShowUnsplashPicker(false);
                  }}
                  onCancel={() => setShowUnsplashPicker(false)}
                />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-amber-900/60">Tags</label>
              {onAddTag && (
                <button
                  type="button"
                  onClick={() => setShowAddTag(!showAddTag)}
                  className="text-xs text-amber-600 hover:text-amber-700"
                >
                  {showAddTag ? "Cancel" : "+ Add custom tag"}
                </button>
              )}
            </div>

            {/* Add Tag Form */}
            {showAddTag && onAddTag && (
              <div className="mt-2 rounded-xl border border-amber-700/15 bg-amber-50/50 p-3">
                <div className="flex gap-2">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name"
                    className="flex-1 rounded-lg border border-amber-700/15 bg-white px-3 py-1.5 text-sm text-amber-950 outline-none focus:border-amber-700/30"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newTagName.trim()) {
                        onAddTag({
                          name: newTagName.trim(),
                          color: newTagColor,
                          categoryId: "custom",
                        });
                        // Add the new tag to draft immediately (it will get the real ID from state)
                        setNewTagName("");
                        setShowAddTag(false);
                      }
                    }}
                    disabled={!newTagName.trim()}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {TAG_COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewTagColor(color)}
                      className={`h-6 w-6 rounded-full transition-transform ${
                        newTagColor === color ? "scale-110 ring-2 ring-offset-1 ring-amber-600" : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tag Categories */}
            {tags.length > 0 ? (
              <div className="mt-2 space-y-3">
                {tagCategories
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((category) => {
                    const categoryTags = tags.filter((t) => t.categoryId === category.id);
                    if (categoryTags.length === 0) return null;
                    return (
                      <div key={category.id}>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-amber-900/40 mb-1.5">
                          {category.name}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {categoryTags.map((tag) => {
                            const isSelected = (draft.tags ?? []).includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  const currentTags = draft.tags ?? [];
                                  update({
                                    tags: isSelected
                                      ? currentTags.filter((t) => t !== tag.id)
                                      : [...currentTags, tag.id],
                                  });
                                }}
                                className={`
                                  inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                                  transition-all duration-150
                                  ${isSelected
                                    ? "ring-2 ring-offset-1"
                                    : "opacity-60 hover:opacity-100"
                                  }
                                `}
                                style={{
                                  backgroundColor: `${tag.color}20`,
                                  color: tag.color,
                                  ...(isSelected ? { ringColor: tag.color } : {}),
                                }}
                              >
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                {/* Custom/Uncategorized Tags */}
                {(() => {
                  const customTags = tags.filter((t) => t.categoryId === "custom" || !tagCategories.some((c) => c.id === t.categoryId));
                  if (customTags.length === 0) return null;
                  return (
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-amber-900/40 mb-1.5">
                        Custom
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {customTags.map((tag) => {
                          const isSelected = (draft.tags ?? []).includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                const currentTags = draft.tags ?? [];
                                update({
                                  tags: isSelected
                                    ? currentTags.filter((t) => t !== tag.id)
                                    : [...currentTags, tag.id],
                                });
                              }}
                              className={`
                                inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
                                transition-all duration-150
                                ${isSelected
                                  ? "ring-2 ring-offset-1"
                                  : "opacity-60 hover:opacity-100"
                                }
                              `}
                              style={{
                                backgroundColor: `${tag.color}20`,
                                color: tag.color,
                                ...(isSelected ? { ringColor: tag.color } : {}),
                              }}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="mt-2 text-xs text-amber-900/50">
                No tags yet. Click &quot;+ Add custom tag&quot; to create one.
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
            <label className="text-xs text-amber-900/60">Checklist</label>
              <button
                onClick={() =>
                  update({
                    checklist: [
                      ...(draft.checklist ?? []),
                      { id: nanoid(), text: "New item", done: false },
                    ],
                  })
                }
                className="text-xs text-amber-900/60 hover:text-amber-900"
              >
                + Add item
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {(draft.checklist ?? []).map((it) => (
                <div key={it.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={it.done}
                    onChange={(e) =>
                      update({
                        checklist: (draft.checklist ?? []).map((x) =>
                          x.id === it.id ? { ...x, done: e.target.checked } : x
                        ),
                      })
                    }
                    className="h-4 w-4 accent-amber-600"
                  />
                  <input
                    value={it.text}
                    onChange={(e) =>
                      update({
                        checklist: (draft.checklist ?? []).map((x) =>
                          x.id === it.id ? { ...x, text: e.target.value } : x
                        ),
                      })
                    }
                    className="flex-1 rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
                  />
                  <button
                    onClick={() =>
                      update({
                        checklist: (draft.checklist ?? []).filter((x) => x.id !== it.id),
                      })
                    }
                    className="text-amber-900/50 hover:text-amber-900"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {(draft.blockedReason || draft.lastOverrideReason) && (
            <div className="rounded-xl border border-amber-700/15 bg-amber-50/70 p-3 text-xs text-amber-900">
              {draft.blockedReason && <div>Blocked: {draft.blockedReason}</div>}
              {draft.lastOverrideReason && (
                <div className="mt-1">
                  Override: {draft.lastOverrideReason}
                </div>
              )}
            </div>
          )}

          {allCards && onAddRelation && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-amber-900/60">Relationships</label>
                <button
                  onClick={() => setShowRelationPicker(!showRelationPicker)}
                  className="text-xs text-amber-600 hover:text-amber-700"
                >
                  {showRelationPicker ? "Cancel" : "+ Add relationship"}
                </button>
              </div>

              {showRelationPicker && (
                <div className="mt-2">
                  <RelationshipPicker
                    cards={allCards}
                    currentCardId={draft.id}
                    onSelect={handleAddRelation}
                    onCancel={() => setShowRelationPicker(false)}
                  />
                </div>
              )}

              {card?.relations && card.relations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.relations.map((rel) => (
                    <RelationshipBadge
                      key={rel.id}
                      relation={rel}
                      targetCard={allCards.find((c) => c.id === rel.targetCardId)}
                      onRemove={onRemoveRelation ? () => handleRemoveRelation(rel.id) : undefined}
                    />
                  ))}
                </div>
              )}

              {(!card?.relations || card.relations.length === 0) && !showRelationPicker && (
                <div className="mt-2 text-xs text-amber-900/50">
                  No relationships yet
                </div>
              )}
            </div>
          )}
        </div>
        </div>

        {/* Fixed Footer */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-amber-700/10 px-4 py-3 sm:flex-row sm:justify-between sm:px-6 sm:py-4">
          <button
            onClick={() => onDelete(draft.id)}
            className="order-2 rounded-full border border-rose-400/30 bg-rose-100 px-4 py-2 text-sm text-rose-700 hover:border-rose-400/50 sm:order-1"
          >
            Delete
          </button>

          <div className="order-1 flex gap-2 sm:order-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-full border border-amber-700/15 bg-amber-50/70 px-4 py-2 text-sm text-amber-900 hover:border-amber-700/30 hover:bg-amber-100/70 sm:flex-none"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="flex-1 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(245,158,11,0.2)] transition hover:-translate-y-0.5 hover:bg-amber-700 sm:flex-none"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
