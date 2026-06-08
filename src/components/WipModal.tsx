import React from "react";
import type { Card, Column, ColumnId, SwimlaneId } from "../app/types";

type Props = {
  open: boolean;
  title: string;
  message: string;
  pressureColumn?: Column;
  pressureCards?: Card[];
  fallbackColumnId?: ColumnId;
  askReason?: boolean;
  reasonLabel?: string;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
  onOpenCard?: (card: Card) => void;
  onMoveCardBack?: (card: Card, toColumn: ColumnId, swimlane?: SwimlaneId) => void;
  onArchiveCard?: (card: Card) => void;
  confirmText: string;
};

export function WipModal({
  open,
  title,
  message,
  pressureColumn,
  pressureCards = [],
  fallbackColumnId,
  askReason,
  reasonLabel,
  onCancel,
  onConfirm,
  onOpenCard,
  onMoveCardBack,
  onArchiveCard,
  confirmText,
}: Props) {
  const reasonId = React.useId();
  const [reason, setReason] = React.useState("");

  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const disabled = askReason ? reason.trim().length === 0 : false;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative max-h-[90vh] w-[640px] max-w-[94vw] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="text-xl font-semibold text-gray-900">{title}</div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</div>

        {pressureColumn && pressureCards.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {pressureColumn.title} is full
                </div>
                <div className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
                  {pressureCards.length}/{pressureColumn.wipLimit} cards are already here.
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {pressureCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-lg border border-amber-200 bg-white p-2 dark:border-amber-900/60 dark:bg-gray-900"
                >
                  <div className="min-w-0 text-sm font-medium text-gray-900 dark:text-white">
                    {card.icon && <span className="mr-1.5">{card.icon}</span>}
                    {card.title}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {onOpenCard && (
                      <button
                        onClick={() => onOpenCard(card)}
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        Open
                      </button>
                    )}
                    {fallbackColumnId && onMoveCardBack && (
                      <button
                        onClick={() => onMoveCardBack(card, fallbackColumnId, card.swimlane)}
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        Move back
                      </button>
                    )}
                    {onArchiveCard && (
                      <button
                        onClick={() => onArchiveCard(card)}
                        className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {askReason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {reasonLabel ?? "Reason"}
            </label>
            <input
              id={reasonId}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
              placeholder="One line"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            disabled={disabled}
            onClick={() => onConfirm(askReason ? reason.trim() : undefined)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
