import React from "react";
import type { Column, Settings } from "../app/types";
import { MOO_COLUMN_COLORS, DEFAULT_COLUMN_ICONS } from "../app/constants";

export function SettingsPanel({
  open,
  settings,
  columns,
  onClose,
  onChange,
  onUpdateColumn,
  onAddColumn,
  onDeleteColumn,
  onReorderColumns,
}: {
  open: boolean;
  settings: Settings;
  columns: Column[];
  onClose: () => void;
  onChange: (settings: Settings) => void;
  onUpdateColumn: (column: Column) => void;
  onAddColumn: (column: Omit<Column, "id" | "order">) => void;
  onDeleteColumn: (id: string, migrateCardsTo?: string) => void;
  onReorderColumns: (columns: Column[]) => void;
}) {
  const [editingColumn, setEditingColumn] = React.useState<Column | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ column: Column; migrateToId: string } | null>(null);

  if (!open) return null;

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const fileInputId = "settings-bg-upload";
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  const handleMooColors = () => {
    sortedColumns.forEach((col) => {
      const mooColor = MOO_COLUMN_COLORS[col.id];
      if (mooColor && mooColor !== col.color) {
        onUpdateColumn({ ...col, color: mooColor });
      }
    });
  };

  const moveColumn = (col: Column, direction: "up" | "down") => {
    const idx = sortedColumns.findIndex((c) => c.id === col.id);
    if (direction === "up" && idx > 0) {
      const newColumns = [...sortedColumns];
      [newColumns[idx], newColumns[idx - 1]] = [newColumns[idx - 1], newColumns[idx]];
      onReorderColumns(newColumns);
    } else if (direction === "down" && idx < sortedColumns.length - 1) {
      const newColumns = [...sortedColumns];
      [newColumns[idx], newColumns[idx + 1]] = [newColumns[idx + 1], newColumns[idx]];
      onReorderColumns(newColumns);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center">
      <div className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="display-font text-xl text-emerald-950">Settings</div>
          <button onClick={onClose} className="text-emerald-900/60 hover:text-emerald-900">✕</button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Background Section */}
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

          {/* Columns Section */}
          <div className="rounded-xl border border-emerald-700/15 bg-white/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-emerald-950">Columns</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleMooColors}
                  className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-3 py-1 text-[11px] text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
                >
                  Use Moo palette
                </button>
                <button
                  type="button"
                  onClick={() => setEditingColumn({
                    id: "",
                    title: "New Column",
                    icon: "📋",
                    color: "#86B6B0",
                    wipLimit: null,
                    isTerminal: false,
                    order: sortedColumns.length,
                  })}
                  className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-3 py-1 text-[11px] text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
                >
                  + Add column
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {sortedColumns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex items-center gap-3 rounded-lg border border-emerald-700/10 bg-white/60 p-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveColumn(col, "up")}
                      className="text-xs text-emerald-900/40 hover:text-emerald-900 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedColumns.length - 1}
                      onClick={() => moveColumn(col, "down")}
                      className="text-xs text-emerald-900/40 hover:text-emerald-900 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <div
                    className="h-6 w-6 rounded-full border border-emerald-700/20"
                    style={{ backgroundColor: col.color }}
                  />

                  <span className="text-base">{col.icon}</span>

                  <div className="flex-1">
                    <span className="text-sm text-emerald-950">{col.title}</span>
                    <span className="ml-2 text-xs text-emerald-900/50">
                      WIP: {col.wipLimit ?? "∞"}
                      {col.isTerminal && " • Terminal"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingColumn(col)}
                    className="rounded-full px-2 py-1 text-xs text-emerald-900/60 hover:bg-emerald-100/80 hover:text-emerald-900"
                  >
                    Edit
                  </button>

                  {sortedColumns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ column: col, migrateToId: sortedColumns.find((c) => c.id !== col.id)?.id ?? "" })}
                      className="rounded-full px-2 py-1 text-xs text-red-600/60 hover:bg-red-100/80 hover:text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Celebrations Toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-emerald-950">Celebrations</div>
              <div className="text-xs text-emerald-900/60">Subtle confetti when moving to terminal column</div>
            </div>
            <input
              type="checkbox"
              checked={settings.celebrations}
              onChange={(e) => set({ celebrations: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </div>

          {/* Reduced Motion Toggle */}
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

      {/* Column Edit Modal */}
      {editingColumn && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm" onClick={() => setEditingColumn(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
            <div className="display-font text-lg text-emerald-950">
              {editingColumn.id ? "Edit Column" : "Add Column"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-emerald-900/60">Title</label>
                <input
                  type="text"
                  value={editingColumn.title}
                  onChange={(e) => setEditingColumn({ ...editingColumn, title: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-emerald-900/60">Icon</label>
                  <input
                    type="text"
                    value={editingColumn.icon}
                    onChange={(e) => setEditingColumn({ ...editingColumn, icon: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {DEFAULT_COLUMN_ICONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setEditingColumn({ ...editingColumn, icon: emoji })}
                        className="rounded-md border border-emerald-700/15 bg-emerald-50/80 px-1.5 py-0.5 text-sm hover:border-emerald-700/30"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-emerald-900/60">Color</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="color"
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="h-10 w-10 cursor-pointer rounded border border-emerald-700/20 bg-transparent"
                    />
                    <input
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="w-24 rounded-lg border border-emerald-700/15 bg-white px-2 py-1 text-xs text-emerald-900 outline-none focus:border-emerald-700/30"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-emerald-900/60">WIP Limit (leave empty for unlimited)</label>
                <input
                  type="number"
                  min={1}
                  value={editingColumn.wipLimit ?? ""}
                  onChange={(e) => setEditingColumn({
                    ...editingColumn,
                    wipLimit: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                  })}
                  placeholder="Unlimited"
                  className="mt-1 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isTerminal"
                  checked={editingColumn.isTerminal}
                  onChange={(e) => setEditingColumn({ ...editingColumn, isTerminal: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
                <label htmlFor="isTerminal" className="text-sm text-emerald-950">
                  Terminal column (triggers celebration)
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingColumn(null)}
                className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-4 py-2 text-sm text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingColumn.id) {
                    onUpdateColumn(editingColumn);
                  } else {
                    const { id, order, ...rest } = editingColumn;
                    onAddColumn(rest);
                  }
                  setEditingColumn(null);
                }}
                className="rounded-full border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
              >
                {editingColumn.id ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-emerald-950/30 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-2xl border border-emerald-700/15 bg-white/95 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)]">
            <div className="display-font text-lg text-emerald-950">Delete Column</div>

            <p className="mt-3 text-sm text-emerald-900/70">
              Are you sure you want to delete &quot;{deleteConfirm.column.title}&quot;?
            </p>

            <div className="mt-4">
              <label className="text-xs text-emerald-900/60">Move existing cards to:</label>
              <select
                value={deleteConfirm.migrateToId}
                onChange={(e) => setDeleteConfirm({ ...deleteConfirm, migrateToId: e.target.value })}
                className="mt-1 w-full rounded-xl border border-emerald-700/15 bg-white px-3 py-2 text-sm text-emerald-950 outline-none focus:border-emerald-700/30"
              >
                <option value="">Delete cards too</option>
                {sortedColumns
                  .filter((c) => c.id !== deleteConfirm.column.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.title}
                    </option>
                  ))}
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-full border border-emerald-700/15 bg-emerald-50/80 px-4 py-2 text-sm text-emerald-900 hover:border-emerald-700/30 hover:bg-emerald-100/80"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteColumn(
                    deleteConfirm.column.id,
                    deleteConfirm.migrateToId || undefined
                  );
                  setDeleteConfirm(null);
                }}
                className="rounded-full border border-red-600 bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
