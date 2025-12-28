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
      <div className="absolute inset-0 bg-amber-950/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[520px] max-w-[92vw] rounded-2xl border border-amber-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
        <div className="display-font text-xl text-amber-950">{title}</div>
        <div className="mt-2 text-sm text-amber-900/70">{message}</div>

        {askReason && (
          <div className="mt-4">
            <label className="text-xs text-amber-900/60">
              {reasonLabel ?? "Reason"}
            </label>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 w-full rounded-xl border border-amber-700/15 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-amber-700/30"
              placeholder="One line"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-amber-700/15 bg-amber-50/70 px-4 py-2 text-sm text-amber-900 hover:border-amber-700/30 hover:bg-amber-100/70"
          >
            Cancel
          </button>
          <button
            disabled={disabled}
            onClick={() => onConfirm(askReason ? reason.trim() : undefined)}
            className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(245,158,11,0.25)] transition hover:-translate-y-0.5 hover:bg-amber-700 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
