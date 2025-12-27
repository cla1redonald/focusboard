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
      <div className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[520px] max-w-[92vw] rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-emerald-950">Settings</div>
          <button onClick={onClose} className="text-emerald-900/60 hover:text-emerald-900">✕</button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
            <div className="text-sm font-semibold text-emerald-950">Background</div>
            <div className="mt-2 text-xs text-emerald-900/60">
              Upload a background image. It&apos;s saved locally in your browser.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                htmlFor={fileInputId}
                className="cursor-pointer rounded-full border border-emerald-700/15 bg-emerald-50/80 px-4 py-2 text-xs text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
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
                  className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-4 py-2 text-xs text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
                >
                  Remove
                </button>
              )}
            </div>

            {settings.backgroundImage && (
              <div className="mt-4 h-[140px] w-full overflow-hidden rounded-2xl border border-emerald-700/15">
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${settings.backgroundImage})` }}
                />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
            <div className="text-sm font-semibold text-emerald-950">Column colors</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {columnKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label className="text-xs text-emerald-900/60 capitalize">{key}</label>
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
                      className="h-8 w-8 cursor-pointer rounded border border-emerald-700/20 bg-transparent"
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
                      className="w-24 rounded-lg border border-emerald-700/15 bg-white px-2 py-1 text-xs text-emerald-900 outline-none focus:border-emerald-700/30"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
            <div className="text-sm font-semibold text-emerald-950">Column icons</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {columnKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <label className="text-xs text-emerald-900/60 capitalize">{key}</label>
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
                      className="w-16 rounded-lg border border-emerald-700/15 bg-white px-2 py-1 text-xs text-emerald-900 outline-none focus:border-emerald-700/30"
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
                          className="rounded-md border border-emerald-700/15 bg-emerald-50/80 px-1.5 py-0.5 text-sm hover:border-emerald-700/30"
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
              <div className="text-sm text-emerald-950">Celebrations</div>
              <div className="text-xs text-emerald-900/60">Subtle confetti on Doing → Done</div>
            </div>
            <input
              type="checkbox"
              checked={settings.celebrations}
              onChange={(e) => set({ celebrations: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-emerald-950">Reduced motion override</div>
              <div className="text-xs text-emerald-900/60">Disables confetti and uses header pulse</div>
            </div>
            <input
              type="checkbox"
              checked={settings.reducedMotionOverride}
              onChange={(e) => set({ reducedMotionOverride: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </div>

          <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
            <div className="text-sm font-semibold text-emerald-950">WIP limits</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["design", "todo", "blocked"] as const).map((k) => (
                <div key={k}>
                  <label className="text-xs text-emerald-900/60 capitalize">{k}</label>
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
                    className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-emerald-900/60">doing (hard)</label>
                <input
                  type="number"
                  value={1}
                  disabled
                  className="mt-2 w-full rounded-xl border border-emerald-700/15 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900/60"
                />
              </div>
            </div>
            <div className="mt-3 text-xs text-emerald-900/60">
              Doing is hard-limited to 1.
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-4 py-2 text-sm text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
