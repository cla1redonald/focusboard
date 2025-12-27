import React from "react";

const SHORTCUTS = [
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["Cmd/Ctrl", "K"], description: "Focus search" },
  { keys: ["Cmd/Ctrl", "Z"], description: "Undo" },
  { keys: ["Cmd/Ctrl", "Shift", "Z"], description: "Redo" },
  { keys: ["Escape"], description: "Close modal / Clear search" },
  { keys: ["Arrow Left/Right"], description: "Navigate between columns" },
  { keys: ["Arrow Up/Down"], description: "Navigate between cards" },
  { keys: ["Enter"], description: "Open focused card" },
  { keys: ["N"], description: "Add new card to focused column" },
  { keys: ["Delete/Backspace"], description: "Delete focused card" },
];

export function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[480px] max-w-[92vw] rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-emerald-950">
            Keyboard Shortcuts
          </div>
          <button
            onClick={onClose}
            className="text-emerald-900/60 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {SHORTCUTS.map((shortcut, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-4 rounded-lg border border-emerald-700/10 bg-white/60 px-3 py-2"
            >
              <span className="text-sm text-emerald-900/80">
                {shortcut.description}
              </span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, keyIdx) => (
                  <React.Fragment key={keyIdx}>
                    {keyIdx > 0 && (
                      <span className="text-xs text-emerald-900/40">+</span>
                    )}
                    <kbd className="rounded-md border border-emerald-700/20 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                      {key}
                    </kbd>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 text-center text-xs text-emerald-900/50">
          Press <kbd className="rounded border border-emerald-700/20 bg-emerald-50 px-1.5 py-0.5 font-medium">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
