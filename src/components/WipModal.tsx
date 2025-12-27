import React from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  askReason?: boolean;
  reasonLabel?: string;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
  confirmText: string;
};

export function WipModal({
  open,
  title,
  message,
  askReason,
  reasonLabel,
  onCancel,
  onConfirm,
  confirmText,
}: Props) {
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const disabled = askReason ? reason.trim().length === 0 : false;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[520px] max-w-[92vw] rounded-2xl border border-white/10 bg-zinc-950/90 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
        <div className="display-font text-xl text-zinc-100">{title}</div>
        <div className="mt-2 text-sm text-zinc-300">{message}</div>

        {askReason && (
          <div className="mt-4">
            <label className="text-xs text-zinc-400">
              {reasonLabel ?? "Reason"}
            </label>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30"
              placeholder="One line"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:border-white/30 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            disabled={disabled}
            onClick={() => onConfirm(askReason ? reason.trim() : undefined)}
            className="rounded-full bg-gradient-to-r from-emerald-400/80 via-emerald-500/90 to-cyan-400/80 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-[0_10px_30px_rgba(16,185,129,0.35)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
