import React from "react";
import type { Card, RelationType } from "../app/types";
import { nanoid } from "nanoid";
import { RelationshipPicker, RelationshipBadge } from "./RelationshipPicker";

const EMOJI_CHOICES = ["✨", "✅", "🧠", "🧩", "🛠️", "📌", "🔥", "🚧", "🎯", "🔍"];

type Props = {
  open: boolean;
  card: Card | null;
  allCards?: Card[];
  onClose: () => void;
  onSave: (card: Card) => void;
  onDelete: (id: string) => void;
  onAddRelation?: (cardId: string, targetCardId: string, relationType: RelationType) => void;
  onRemoveRelation?: (cardId: string, relationId: string) => void;
};

export function CardModal({
  open,
  card,
  allCards,
  onClose,
  onSave,
  onDelete,
  onAddRelation,
  onRemoveRelation,
}: Props) {
  const [draft, setDraft] = React.useState<Card | null>(card);
  const [showRelationPicker, setShowRelationPicker] = React.useState(false);

  React.useEffect(() => {
    setDraft(card);
    setShowRelationPicker(false);
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
    <div className="fixed inset-0 z-[1100] flex items-center justify-center">
      <div className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[720px] max-w-[94vw] rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-emerald-950">Edit card</div>
          <button onClick={onClose} className="text-emerald-900/60 hover:text-emerald-900">✕</button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-emerald-900/60">Title</label>
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
            />
          </div>

          <div>
            <label className="text-xs text-emerald-900/60">Icon (emoji)</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={draft.icon ?? ""}
                onChange={(e) => update({ icon: e.target.value })}
                placeholder="Pick or type"
                className="w-28 rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
              />
              <div className="flex flex-wrap gap-1">
                {EMOJI_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => update({ icon: emoji })}
                    className="rounded-lg border border-emerald-700/15 bg-emerald-50/70 px-2 py-1 text-base hover:border-emerald-700/30"
                  >
                    {emoji}
                  </button>
                ))}
                {draft.icon && (
                  <button
                    type="button"
                    onClick={() => update({ icon: undefined })}
                    className="rounded-lg border border-emerald-700/15 bg-emerald-50/70 px-2 py-1 text-xs text-emerald-900 hover:border-emerald-700/30"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-emerald-900/60">Notes</label>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              className="mt-2 w-full min-h-[90px] rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-emerald-900/60">Link</label>
              <input
                value={draft.link ?? ""}
                onChange={(e) => update({ link: e.target.value })}
                className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
              />
            </div>
            <div>
              <label className="text-xs text-emerald-900/60">Due date</label>
              <input
                type="date"
                value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
                onChange={(e) =>
                  update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                }
                className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-emerald-900/60">Tags (comma separated)</label>
            <input
              value={(draft.tags ?? []).join(", ")}
              onChange={(e) =>
                update({
                  tags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
            <label className="text-xs text-emerald-900/60">Checklist</label>
              <button
                onClick={() =>
                  update({
                    checklist: [
                      ...(draft.checklist ?? []),
                      { id: nanoid(), text: "New item", done: false },
                    ],
                  })
                }
                className="text-xs text-emerald-900/60 hover:text-emerald-900"
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
                    className="flex-1 rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
                  />
                  <button
                    onClick={() =>
                      update({
                        checklist: (draft.checklist ?? []).filter((x) => x.id !== it.id),
                      })
                    }
                    className="text-emerald-900/50 hover:text-emerald-900"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {(draft.blockedReason || draft.lastOverrideReason) && (
            <div className="rounded-xl border border-emerald-700/15 bg-emerald-50/70 p-3 text-xs text-emerald-900">
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
                <label className="text-xs text-emerald-900/60">Relationships</label>
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
                <div className="mt-2 text-xs text-emerald-900/50">
                  No relationships yet
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <button
            onClick={() => onDelete(draft.id)}
            className="rounded-full border border-rose-400/30 bg-rose-100 px-4 py-2 text-sm text-rose-700 hover:border-rose-400/50"
          >
            Delete
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-full border border-emerald-700/15 bg-emerald-50/70 px-4 py-2 text-sm text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/70"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(16,185,129,0.2)] transition hover:-translate-y-0.5 hover:bg-emerald-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
