import type { Settings } from "../app/types";

export function SettingsPanel({
  open,
  settings,
  onClose,
  onChange,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (settings: Settings) => void;
}) {
  if (!open) return null;

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const fileInputId = "settings-bg-upload";
  const columnKeys = ["backlog", "design", "todo", "doing", "blocked", "done"] as const;
  const emojiChoices = ["🗂️", "🎨", "📝", "⚡", "⛔", "✅", "🔍", "🧠", "💡", "📌"];

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[520px] max-w-[92vw] rounded-2xl border border-white/10 bg-zinc-950/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-zinc-100">Settings</div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="text-sm font-semibold text-zinc-100">Background</div>
            <div className="mt-2 text-xs text-zinc-400">
              Upload a background image. It&apos;s saved locally in your browser.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                htmlFor={fileInputId}
                className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-200 hover:border-white/30 hover:bg-white/10"
              >
                Upload image
              </label>
              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = typeof reader.result === "string" ? reader.result : null;
                    onChange({ ...settings, backgroundImage: result });
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {settings.backgroundImage && (
                <button
                  onClick={() => set({ backgroundImage: null })}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-200 hover:border-white/30 hover:bg-white/10"
                >
                  Remove
                </button>
              )}
            </div>

            {settings.backgroundImage && (
              <div className="mt-4 h-[140px] w-full overflow-hidden rounded-2xl border border-white/10">
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${settings.backgroundImage})` }}
                />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="text-sm font-semibold text-zinc-100">Column colors</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {columnKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label className="text-xs text-zinc-400 capitalize">{key}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.columnColors[key]}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          columnColors: {
                            ...settings.columnColors,
                            [key]: e.target.value,
                          },
                        })
                      }
                      className="h-8 w-8 cursor-pointer rounded border border-white/10 bg-transparent"
                    />
                    <input
                      value={settings.columnColors[key]}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          columnColors: {
                            ...settings.columnColors,
                            [key]: e.target.value,
                          },
                        })
                      }
                      className="w-24 rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-white/30"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="text-sm font-semibold text-zinc-100">Column icons</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {columnKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label className="text-xs text-zinc-400 capitalize">{key}</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={settings.columnIcons[key]}
                      onChange={(e) =>
                        onChange({
                          ...settings,
                          columnIcons: {
                            ...settings.columnIcons,
                            [key]: e.target.value,
                          },
                        })
                      }
                      className="w-16 rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-white/30"
                    />
                    <div className="flex flex-wrap gap-1">
                      {emojiChoices.map((emoji) => (
                        <button
                          key={`${key}-${emoji}`}
                          type="button"
                          onClick={() =>
                            onChange({
                              ...settings,
                              columnIcons: {
                                ...settings.columnIcons,
                                [key]: emoji,
                              },
                            })
                          }
                          className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-sm hover:border-white/30"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-100">Celebrations</div>
              <div className="text-xs text-zinc-400">Subtle confetti on Doing → Done</div>
            </div>
            <input
              type="checkbox"
              checked={settings.celebrations}
              onChange={(e) => set({ celebrations: e.target.checked })}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-100">Reduced motion override</div>
              <div className="text-xs text-zinc-400">Disables confetti and uses header pulse</div>
            </div>
            <input
              type="checkbox"
              checked={settings.reducedMotionOverride}
              onChange={(e) => set({ reducedMotionOverride: e.target.checked })}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="text-sm font-semibold text-zinc-100">WIP limits</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["design", "todo", "blocked"] as const).map((k) => (
                <div key={k}>
                  <label className="text-xs text-zinc-400 capitalize">{k}</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.wip[k]}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        wip: { ...settings.wip, [k]: Math.max(1, Number(e.target.value)) },
                      })
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-zinc-400">doing (hard)</label>
                <input
                  type="number"
                  value={1}
                  disabled
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-500"
                />
              </div>
            </div>
            <div className="mt-3 text-xs text-zinc-500">
              Doing is hard-limited to 1.
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:border-white/30 hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
