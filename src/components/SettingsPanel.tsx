import React from "react";
import { X } from "lucide-react";
import type { AppState, Column, Settings, Tag, TagCategory } from "../app/types";
import { COLUMN_COLORS, DEFAULT_COLUMN_ICONS, TAG_COLOR_PALETTE } from "../app/constants";
import { ExportImportPanel } from "./ExportImportPanel";
import type { ImportMode } from "../app/exportImport";
import { isSupabaseConfigured } from "../app/supabase";

export function SettingsPanel({
  open,
  settings,
  columns,
  state,
  onClose,
  onChange,
  onUpdateColumn,
  onAddColumn,
  onDeleteColumn,
  onReorderColumns,
  onImport,
  onSignOut,
  onAddTag,
  onUpdateTag,
  onDeleteTag,
  onAddTagCategory,
  onUpdateTagCategory,
  onDeleteTagCategory,
}: {
  open: boolean;
  settings: Settings;
  columns: Column[];
  state: AppState;
  onClose: () => void;
  onChange: (settings: Settings) => void;
  onUpdateColumn: (column: Column) => void;
  onAddColumn: (column: Omit<Column, "id" | "order">) => void;
  onDeleteColumn: (id: string, migrateCardsTo?: string) => void;
  onReorderColumns: (columns: Column[]) => void;
  onImport: (newState: AppState, mode: ImportMode) => void;
  onSignOut?: () => void;
  onAddTag?: (tag: Omit<Tag, "id">) => void;
  onUpdateTag?: (tag: Tag) => void;
  onDeleteTag?: (id: string) => void;
  onAddTagCategory?: (category: Omit<TagCategory, "id" | "order">) => void;
  onUpdateTagCategory?: (category: TagCategory) => void;
  onDeleteTagCategory?: (id: string) => void;
}) {
  const [editingColumn, setEditingColumn] = React.useState<Column | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ column: Column; migrateToId: string } | null>(null);
  const [editingTag, setEditingTag] = React.useState<Tag | null>(null);
  const [editingCategory, setEditingCategory] = React.useState<TagCategory | null>(null);

  if (!open) return null;

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const fileInputId = "settings-bg-upload";
  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  const handleResetColors = () => {
    sortedColumns.forEach((col) => {
      const defaultColor = COLUMN_COLORS[col.id];
      if (defaultColor && defaultColor !== col.color) {
        onUpdateColumn({ ...col, color: defaultColor });
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
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold text-gray-900">Settings</div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Background Section */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="text-sm font-semibold text-gray-900">Background</div>
            <div className="mt-2 text-xs text-gray-500">
              Upload a background image. It&apos;s saved locally in your browser.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                htmlFor={fileInputId}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-50"
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
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                >
                  Remove
                </button>
              )}
            </div>

            {settings.backgroundImage && (
              <div className="mt-4 h-[140px] w-full overflow-hidden rounded-lg border border-gray-200">
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${settings.backgroundImage})` }}
                />
              </div>
            )}
          </div>

          {/* Columns Section */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900">Columns</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleResetColors}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                >
                  Reset colors
                </button>
                <button
                  type="button"
                  onClick={() => setEditingColumn({
                    id: "",
                    title: "New Column",
                    icon: "📋",
                    color: "#10b981",
                    wipLimit: null,
                    isTerminal: false,
                    order: sortedColumns.length,
                  })}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                >
                  + Add column
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {sortedColumns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveColumn(col, "up")}
                      className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedColumns.length - 1}
                      onClick={() => moveColumn(col, "down")}
                      className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  <div
                    className="h-6 w-6 rounded-full border border-gray-200"
                    style={{ backgroundColor: col.color }}
                  />

                  <span className="text-base">{col.icon}</span>

                  <div className="flex-1">
                    <span className="text-sm text-gray-900">{col.title}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      WIP: {col.wipLimit ?? "∞"}
                      {col.isTerminal && " • Terminal"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingColumn(col)}
                    className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  >
                    Edit
                  </button>

                  {sortedColumns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ column: col, migrateToId: sortedColumns.find((c) => c.id !== col.id)?.id ?? "" })}
                      className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tags Section */}
          {onAddTag && onUpdateTag && onDeleteTag && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">Tags</div>
                <div className="flex gap-2">
                  {onAddTagCategory && (
                    <button
                      type="button"
                      onClick={() => setEditingCategory({
                        id: "",
                        name: "New Category",
                        order: (state.tagCategories?.length ?? 0),
                      })}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    >
                      + Category
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingTag({
                      id: "",
                      name: "New Tag",
                      color: TAG_COLOR_PALETTE[0],
                      categoryId: state.tagCategories?.[0]?.id ?? "",
                    })}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                  >
                    + Tag
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {(state.tagCategories ?? [])
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((category) => {
                    const categoryTags = (state.tags ?? []).filter((t) => t.categoryId === category.id);
                    return (
                      <div key={category.id} className="rounded-lg border border-gray-200 bg-white p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            {category.name}
                          </span>
                          <div className="flex gap-1">
                            {onUpdateTagCategory && (
                              <button
                                type="button"
                                onClick={() => setEditingCategory(category)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                              >
                                Edit
                              </button>
                            )}
                            {onDeleteTagCategory && (state.tagCategories?.length ?? 0) > 1 && (
                              <button
                                type="button"
                                onClick={() => onDeleteTagCategory(category.id)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50 hover:text-red-600"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {categoryTags.map((tag) => (
                            <div
                              key={tag.id}
                              className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                              style={{
                                backgroundColor: `${tag.color}20`,
                              }}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                              <span className="text-xs font-medium" style={{ color: tag.color }}>
                                {tag.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingTag(tag)}
                                className="ml-1 opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 hover:text-gray-700"
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteTag(tag.id)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-600"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          {categoryTags.length === 0 && (
                            <span className="text-xs text-gray-400 italic">No tags</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Celebrations Toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-gray-900">Celebrations</div>
              <div className="text-xs text-gray-500">Subtle confetti when moving to terminal column</div>
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
              <div className="text-sm text-gray-900">Reduced motion override</div>
              <div className="text-xs text-gray-500">Disables confetti and uses header pulse</div>
            </div>
            <input
              type="checkbox"
              checked={settings.reducedMotionOverride}
              onChange={(e) => set({ reducedMotionOverride: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </div>

          {/* Analytics Section */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="text-sm font-semibold text-gray-900">Analytics</div>

            <div className="mt-3 space-y-4">
              {/* Aging WIP Indicators Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">Aging WIP indicators</div>
                  <div className="text-xs text-gray-500">
                    Show colored dots on cards based on age (yellow: 3d, orange: 7d, red: 14d)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showAgingIndicators}
                  onChange={(e) => set({ showAgingIndicators: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </div>

              {/* Stale Card Threshold */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">Stale card threshold</div>
                  <div className="text-xs text-gray-500">
                    Days of inactivity before a card is considered stale
                  </div>
                </div>
                <select
                  value={settings.staleCardThreshold}
                  onChange={(e) => set({ staleCardThreshold: Number(e.target.value) as 3 | 7 | 14 })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>

              {/* Auto Priority Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">Auto-assign priority from due dates</div>
                  <div className="text-xs text-gray-500">
                    Automatically add priority tags based on how soon cards are due
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoPriorityFromDueDate}
                  onChange={(e) => set({ autoPriorityFromDueDate: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </div>

              {/* Stale Backlog Threshold */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900">Stale backlog warning</div>
                  <div className="text-xs text-gray-500">
                    Show warning on backlog cards without due dates after this many days
                  </div>
                </div>
                <select
                  value={settings.staleBacklogThreshold}
                  onChange={(e) => set({ staleBacklogThreshold: Number(e.target.value) as 3 | 7 | 14 })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>
            </div>
          </div>

          {/* Export/Import Section */}
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="mb-3 text-sm font-semibold text-gray-900">Data Management</div>
            <ExportImportPanel state={state} onImport={onImport} />
          </div>

          {/* Account Section - only show when Supabase is configured */}
          {isSupabaseConfigured() && onSignOut && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Account</div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Your data is synced to the cloud
                </div>
                <button
                  onClick={onSignOut}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>

      {/* Column Edit Modal */}
      {editingColumn && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setEditingColumn(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900">
              {editingColumn.id ? "Edit Column" : "Add Column"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500">Title</label>
                <input
                  type="text"
                  value={editingColumn.title}
                  onChange={(e) => setEditingColumn({ ...editingColumn, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-gray-500">Icon</label>
                  <input
                    type="text"
                    value={editingColumn.icon}
                    onChange={(e) => setEditingColumn({ ...editingColumn, icon: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {DEFAULT_COLUMN_ICONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setEditingColumn({ ...editingColumn, icon: emoji })}
                        className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-sm hover:border-gray-300 hover:bg-gray-100"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500">Color</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="color"
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="h-10 w-10 cursor-pointer rounded border border-gray-200 bg-transparent"
                    />
                    <input
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">WIP Limit (leave empty for unlimited)</label>
                <input
                  type="number"
                  min={1}
                  value={editingColumn.wipLimit ?? ""}
                  onChange={(e) => setEditingColumn({
                    ...editingColumn,
                    wipLimit: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                  })}
                  placeholder="Unlimited"
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                <label htmlFor="isTerminal" className="text-sm text-gray-900">
                  Terminal column (triggers celebration)
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingColumn(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
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
                className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
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
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900">Delete Column</div>

            <p className="mt-3 text-sm text-gray-600">
              Are you sure you want to delete &quot;{deleteConfirm.column.title}&quot;?
            </p>

            <div className="mt-4">
              <label className="text-xs text-gray-500">Move existing cards to:</label>
              <select
                value={deleteConfirm.migrateToId}
                onChange={(e) => setDeleteConfirm({ ...deleteConfirm, migrateToId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
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
                className="rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag Edit Modal */}
      {editingTag && onAddTag && onUpdateTag && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setEditingTag(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900">
              {editingTag.id ? "Edit Tag" : "Add Tag"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <input
                  type="text"
                  value={editingTag.name}
                  onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500">Category</label>
                <select
                  value={editingTag.categoryId}
                  onChange={(e) => setEditingTag({ ...editingTag, categoryId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {(state.tagCategories ?? []).map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500">Color</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TAG_COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditingTag({ ...editingTag, color })}
                      className={`h-8 w-8 rounded-full border-2 transition ${
                        editingTag.color === color
                          ? "border-gray-900 ring-2 ring-emerald-400"
                          : "border-transparent hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="color"
                    value={editingTag.color}
                    onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-200 bg-transparent"
                  />
                  <input
                    value={editingTag.color}
                    onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                    className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="text-xs text-gray-500">Preview</label>
                <div className="mt-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      backgroundColor: `${editingTag.color}20`,
                      color: editingTag.color,
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: editingTag.color }}
                    />
                    {editingTag.name || "Tag name"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingTag(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingTag.id) {
                    onUpdateTag(editingTag);
                  } else {
                    const { id, ...rest } = editingTag;
                    onAddTag(rest);
                  }
                  setEditingTag(null);
                }}
                disabled={!editingTag.name.trim() || !editingTag.categoryId}
                className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {editingTag.id ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Edit Modal */}
      {editingCategory && onAddTagCategory && onUpdateTagCategory && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={() => setEditingCategory(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900">
              {editingCategory.id ? "Edit Category" : "Add Category"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <input
                  type="text"
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingCategory(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingCategory.id) {
                    onUpdateTagCategory(editingCategory);
                  } else {
                    const { id, order, ...rest } = editingCategory;
                    onAddTagCategory(rest);
                  }
                  setEditingCategory(null);
                }}
                disabled={!editingCategory.name.trim()}
                className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {editingCategory.id ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
