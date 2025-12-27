import React from "react";
import type { Card } from "../app/types";
import { nanoid } from "nanoid";

const EMOJI_CHOICES = ["✨", "✅", "🧠", "🧩", "🛠️", "📌", "🔥", "🚧", "🎯", "🔍"];

type Props = {
  open: boolean;
  card: Card | null;
  onClose: () => void;
  onSave: (card: Card) => void;
  onDelete: (id: string) => void;
};

export function CardModal({ open, card, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = React.useState<Card | null>(card);

  React.useEffect(() => {
    setDraft(card);
  }, [card]);

  if (!open || !draft) return null;

  const update = (patch: Partial<Card>) => setDraft({ ...draft, ...patch });

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[720px] max-w-[94vw] rounded-2xl border border-white/10 bg-zinc-950/95 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-zinc-100">Edit card</div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-400">Title</label>
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400">Icon (emoji)</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={draft.icon ?? ""}
                onChange={(e) => update({ icon: e.target.value })}
                placeholder="Pick or type"
                className="w-28 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
              />
              <div className="flex flex-wrap gap-1">
                {EMOJI_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => update({ icon: emoji })}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-base hover:border-white/30"
                  >
                    {emoji}
                  </button>
                ))}
                {draft.icon && (
                  <button
                    type="button"
                    onClick={() => update({ icon: undefined })}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-300 hover:border-white/30"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400">Notes</label>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
              className="mt-2 w-full min-h-[90px] rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400">Link</label>
              <input
                value={draft.link ?? ""}
                onChange={(e) => update({ link: e.target.value })}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Due date</label>
              <input
                type="date"
                value={draft.dueDate ? draft.dueDate.slice(0, 10) : ""}
                onChange={(e) =>
                  update({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400">Tags (comma separated)</label>
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
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-400">Checklist</label>
              <button
                onClick={() =>
                  update({
                    checklist: [
                      ...(draft.checklist ?? []),
                      { id: nanoid(), text: "New item", done: false },
                    ],
                  })
                }
                className="text-xs text-zinc-300 hover:text-zinc-100"
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
                    className="flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
                  />
                  <button
                    onClick={() =>
                      update({
                        checklist: (draft.checklist ?? []).filter((x) => x.id !== it.id),
                      })
                    }
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {(draft.blockedReason || draft.lastOverrideReason) && (
            <div className="rounded-xl border border-white/10 bg-black/50 p-3 text-xs text-zinc-300">
              {draft.blockedReason && <div>Blocked: {draft.blockedReason}</div>}
              {draft.lastOverrideReason && (
                <div className="mt-1">
                  Override: {draft.lastOverrideReason}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <button
            onClick={() => onDelete(draft.id)}
            className="rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:border-rose-400/60"
          >
            Delete
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:border-white/30 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(draft)}
              className="rounded-full bg-gradient-to-r from-indigo-400/80 via-sky-400/90 to-cyan-300/90 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition hover:-translate-y-0.5"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
