import React from "react";
import { X, Trash2 } from "lucide-react";
import type { Card, RelationType, SwimlaneId, Tag, TagCategory } from "../app/types";
import { nanoid } from "nanoid";
import { RelationshipPicker, RelationshipBadge } from "./RelationshipPicker";
import { TAG_COLOR_PALETTE, DEFAULT_SWIMLANES } from "../app/constants";
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

const RECENT_EMOJIS_KEY = "focusboard:recent_emojis";
const MAX_RECENT_EMOJIS = 8;

function loadRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji: string): string[] {
  const recent = loadRecentEmojis();
  const updated = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJIS);
  localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
  return updated;
}

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
  const [showUrlInput, setShowUrlInput] = React.useState(false);
  const [customUrl, setCustomUrl] = React.useState("");
  const [recentEmojis, setRecentEmojis] = React.useState<string[]>(() => loadRecentEmojis());
  const emojiInputRef = React.useRef<HTMLInputElement>(null);

  const selectEmoji = (emoji: string) => {
    update({ icon: emoji });
    setRecentEmojis(saveRecentEmoji(emoji));
  };

  React.useEffect(() => {
    setDraft(card);
    setShowRelationPicker(false);
    setShowAddTag(false);
    setNewTagName("");
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    setShowUnsplashPicker(false);
    setShowUrlInput(false);
    setCustomUrl("");
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
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col rounded-xl border border-gray-200 bg-white shadow-xl">
        {/* Fixed Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="text-lg font-semibold text-gray-900 sm:text-xl">Edit card</div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500">Title</label>
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Icon (emoji)</label>
            <div className="mt-1.5 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  ref={emojiInputRef}
                  value={draft.icon ?? ""}
                  onChange={(e) => update({ icon: e.target.value })}
                  placeholder="Type or paste emoji"
                  className="w-32 rounded-md border border-gray-200 bg-white px-3 py-2 text-center text-lg text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
                {draft.icon && (
                  <button
                    type="button"
                    onClick={() => update({ icon: undefined })}
                    className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    Clear
                  </button>
                )}
                <span className="text-[10px] text-gray-400">
                  Tip: Press {navigator.platform.includes("Mac") ? "⌘+Ctrl+Space" : "Win+."} for full emoji keyboard
                </span>
              </div>
              {/* Recent emojis */}
              {recentEmojis.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">Recently used</div>
                  <div className="flex flex-wrap gap-1">
                    {recentEmojis.map((emoji) => (
                      <button
                        key={`recent-${emoji}`}
                        type="button"
                        onClick={() => selectEmoji(emoji)}
                        className={`rounded-md border px-2 py-1 text-base transition ${
                          draft.icon === emoji
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-gray-200 bg-gray-50 hover:border-gray-300"
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* All emojis */}
              <div className="flex flex-wrap gap-1">
                {EMOJI_CHOICES.filter((e) => !recentEmojis.includes(e)).map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => selectEmoji(emoji)}
                    className={`rounded-md border px-2 py-1 text-base transition ${
                      draft.icon === emoji
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-gray-200 bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Notes</label>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              className="mt-1.5 w-full min-h-[90px] rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-500">Link</label>
              <input
                value={draft.link ?? ""}
                onChange={(e) => update({ link: e.target.value })}
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Due date</label>
              <input
                type="date"
                value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
                onChange={(e) =>
                  update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                }
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Swimlane</label>
            <div className="mt-1.5 flex gap-2">
              {DEFAULT_SWIMLANES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => update({ swimlane: s.id as SwimlaneId })}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                    (draft.swimlane ?? "work") === s.id
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                  style={{
                    borderColor: (draft.swimlane ?? "work") === s.id ? s.color : undefined,
                    backgroundColor: (draft.swimlane ?? "work") === s.id ? `${s.color}15` : undefined,
                  }}
                >
                  <span className="text-base">{s.icon}</span>
                  <span className="text-gray-900">{s.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Card Background */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">Card Background</label>
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
                <div className="relative aspect-video w-full max-w-[200px] overflow-hidden rounded-lg border border-gray-200">
                  <img
                    src={draft.backgroundImage}
                    alt="Card background"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowUnsplashPicker(true); setShowUrlInput(false); }}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Search Unsplash
                  </button>
                  <span className="text-xs text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => { setShowUrlInput(true); setShowUnsplashPicker(false); }}
                    className="text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Paste URL
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowUnsplashPicker(true); setShowUrlInput(false); }}
                  className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:border-gray-400 hover:bg-gray-100"
                >
                  Search Unsplash
                </button>
                <button
                  type="button"
                  onClick={() => { setShowUrlInput(true); setShowUnsplashPicker(false); }}
                  className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600 hover:border-gray-400 hover:bg-gray-100"
                >
                  Paste URL
                </button>
              </div>
            )}

            {/* URL Input */}
            {showUrlInput && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-500 mb-2">
                  Paste an image URL (Google Drive, Dropbox, etc.)
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customUrl.trim()) {
                        update({ backgroundImage: customUrl.trim() });
                        setShowUrlInput(false);
                        setCustomUrl("");
                      }
                    }}
                    disabled={!customUrl.trim()}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowUrlInput(false); setCustomUrl(""); }}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-gray-400">
                  Tip: For Google Drive, use "Get link" → "Anyone with the link" and change /file/d/ID/view to /uc?id=ID
                </div>
              </div>
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
              <label className="text-xs text-gray-500">Tags</label>
              {onAddTag && (
                <button
                  type="button"
                  onClick={() => setShowAddTag(!showAddTag)}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
                >
                  {showAddTag ? "Cancel" : "+ Add custom tag"}
                </button>
              )}
            </div>

            {/* Add Tag Form */}
            {showAddTag && onAddTag && (
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex gap-2">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name"
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-emerald-500"
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
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
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
                        newTagColor === color ? "scale-110 ring-2 ring-offset-1 ring-emerald-600" : "hover:scale-105"
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
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1.5">
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
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-1.5">
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
              <div className="mt-2 text-xs text-gray-400">
                No tags yet. Click &quot;+ Add custom tag&quot; to create one.
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
            <label className="text-xs text-gray-500">Checklist</label>
              <span className="text-[10px] text-gray-400">Press Enter to add item</span>
            </div>
            <div className="mt-2 space-y-2">
              {(draft.checklist ?? []).map((it, idx) => (
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
                    className="h-4 w-4 accent-emerald-600"
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const newId = nanoid();
                        const currentChecklist = draft.checklist ?? [];
                        const newChecklist = [
                          ...currentChecklist.slice(0, idx + 1),
                          { id: newId, text: "", done: false },
                          ...currentChecklist.slice(idx + 1),
                        ];
                        update({ checklist: newChecklist });
                        // Focus the new input after render
                        setTimeout(() => {
                          const inputs = document.querySelectorAll<HTMLInputElement>('[data-checklist-input]');
                          inputs[idx + 1]?.focus();
                        }, 0);
                      } else if (e.key === "Backspace" && it.text === "") {
                        e.preventDefault();
                        const currentChecklist = draft.checklist ?? [];
                        if (currentChecklist.length > 1) {
                          update({ checklist: currentChecklist.filter((x) => x.id !== it.id) });
                          // Focus previous input
                          setTimeout(() => {
                            const inputs = document.querySelectorAll<HTMLInputElement>('[data-checklist-input]');
                            inputs[Math.max(0, idx - 1)]?.focus();
                          }, 0);
                        }
                      }
                    }}
                    data-checklist-input
                    placeholder="Type here..."
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() =>
                      update({
                        checklist: (draft.checklist ?? []).filter((x) => x.id !== it.id),
                      })
                    }
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {/* Add new item input */}
              <div className="flex items-center gap-2 pt-1">
                <div className="h-4 w-4" /> {/* Spacer for checkbox alignment */}
                <input
                  placeholder="+ Add item..."
                  className="flex-1 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:bg-white focus:border-solid"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const input = e.target as HTMLInputElement;
                      const text = input.value.trim();
                      if (text) {
                        update({
                          checklist: [
                            ...(draft.checklist ?? []),
                            { id: nanoid(), text, done: false },
                          ],
                        });
                        input.value = "";
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (text) {
                      update({
                        checklist: [
                          ...(draft.checklist ?? []),
                          { id: nanoid(), text, done: false },
                        ],
                      });
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {(draft.blockedReason || draft.lastOverrideReason) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
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
                <label className="text-xs text-gray-500">Relationships</label>
                <button
                  onClick={() => setShowRelationPicker(!showRelationPicker)}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
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
                <div className="mt-2 text-xs text-gray-400">
                  No relationships yet
                </div>
              )}
            </div>
          )}
        </div>
        </div>

        {/* Fixed Footer */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-between sm:px-6 sm:py-4">
          <button
            onClick={() => onDelete(draft.id)}
            className="order-2 flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 hover:bg-red-100 sm:order-1"
          >
            <Trash2 size={16} />
            Delete
          </button>

          <div className="order-1 flex gap-2 sm:order-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:flex-none"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 sm:flex-none"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
