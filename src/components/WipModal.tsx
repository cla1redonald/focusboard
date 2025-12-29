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
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[520px] max-w-[92vw] rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div className="text-xl font-semibold text-zinc-900">{title}</div>
        <div className="mt-2 text-sm text-zinc-600">{message}</div>

        {askReason && (
          <div className="mt-4">
            <label className="text-xs font-medium text-zinc-500">
              {reasonLabel ?? "Reason"}
            </label>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
              placeholder="One line"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            disabled={disabled}
            onClick={() => onConfirm(askReason ? reason.trim() : undefined)}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
