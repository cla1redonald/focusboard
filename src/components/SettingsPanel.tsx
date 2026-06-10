import React from "react";
import { X, Sun, Moon, Monitor, Copy, Check, type LucideIcon } from "lucide-react";
import type { AppState, Column, Settings, Tag, TagCategory, ThemeMode } from "../app/types";
import { COLUMN_COLORS, DEFAULT_COLUMN_ICONS, ICON_MAP, TAG_COLOR_PALETTE } from "../app/constants";
import { ExportImportPanel } from "./ExportImportPanel";
import type { ImportMode } from "../app/exportImport";
import { supabase, isSupabaseConfigured } from "../app/supabase";

// --- API token types ---
type ApiToken = {
  id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type NewTokenResult = {
  token: string; // plaintext — shown once
  id: string;
  name: string;
};

// The API envelope (api/_lib/envelope.ts): { ok: true, data } | { ok: false, error }
type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; hint?: string } };

function apiErrorMessage(body: ApiEnvelope<unknown>, fallback: string): string {
  return !body.ok && body.error?.message ? body.error.message : fallback;
}

// --- Token fetch helpers ---
async function fetchSessionToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(path: string, opts: RequestInit): Promise<Response> {
  const token = await fetchSessionToken();
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

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

  // API tokens state
  const [tokens, setTokens] = React.useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = React.useState(false);
  const [tokensError, setTokensError] = React.useState<string | null>(null);
  const [newTokenName, setNewTokenName] = React.useState("");
  const [creatingToken, setCreatingToken] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [revealedToken, setRevealedToken] = React.useState<NewTokenResult | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [noSession, setNoSession] = React.useState(false);

  // Load tokens when the panel opens — but only if actually signed in. In demo mode
  // (or any no-session state) there is no session token, so calling /api/tokens would
  // 401 and log a console error. Gate on the session first and show a friendly prompt.
  React.useEffect(() => {
    if (!open || !isSupabaseConfigured()) return;
    let cancelled = false;
    setTokensError(null);
    setTokensLoading(true);
    void (async () => {
      const sessionToken = await fetchSessionToken();
      if (cancelled) return;
      if (!sessionToken) {
        setNoSession(true);
        setTokens([]);
        setTokensLoading(false);
        return;
      }
      setNoSession(false);
      try {
        const r = await apiFetch("/api/tokens", { method: "GET" });
        const body = await r.json() as ApiEnvelope<{ tokens: ApiToken[] }>;
        if (!r.ok || !body.ok) throw new Error(apiErrorMessage(body, "Failed to load tokens"));
        if (!cancelled) setTokens(body.data.tokens ?? []);
      } catch (err) {
        if (!cancelled) setTokensError(err instanceof Error ? err.message : "Failed to load tokens");
      } finally {
        if (!cancelled) setTokensLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleCreateToken = async () => {
    if (!newTokenName.trim()) return;
    setCreatingToken(true);
    setCreateError(null);
    try {
      const r = await apiFetch("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: newTokenName.trim() }),
      });
      const body = await r.json() as ApiEnvelope<NewTokenResult>;
      if (!r.ok || !body.ok) throw new Error(apiErrorMessage(body, "Failed to create token"));
      setRevealedToken({ token: body.data.token, id: body.data.id, name: body.data.name });
      setNewTokenName("");
      // Refresh list — token shows as active but without the plaintext
      setTokens((prev) => [
        {
          id: body.data.id,
          name: body.data.name,
          scopes: ["capture:read", "capture:write", "board:read", "focus:read", "focus:write", "card:write"],
          last_used_at: null,
          created_at: new Date().toISOString(),
          revoked_at: null,
        },
        ...prev,
      ]);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    setRevokingId(id);
    try {
      const r = await apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json() as ApiEnvelope<unknown>;
        throw new Error(apiErrorMessage(body, "Failed to revoke token"));
      }
      setTokens((prev) =>
        prev.map((t) => (t.id === id ? { ...t, revoked_at: new Date().toISOString() } : t))
      );
    } catch {
      // Silently ignore — user can retry
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyToken = async (plaintext: string) => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text — clipboard denied
    }
  };

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
      <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold text-gray-900 dark:text-white">Settings</div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Background Section */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Background</div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Upload a background image. It&apos;s saved locally in your browser.
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label
                htmlFor={fileInputId}
                className="cursor-pointer rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-xs text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
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
                  className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-xs text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Remove
                </button>
              )}
            </div>

            {settings.backgroundImage && (
              <div className="mt-4 h-[140px] w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${settings.backgroundImage})` }}
                />
              </div>
            )}
          </div>

          {/* Appearance Section */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Appearance</div>
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Choose your preferred color theme</div>

            <div className="mt-3 flex gap-2">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Monitor },
                ] as { value: ThemeMode; label: string; icon: LucideIcon }[]
              ).map((option) => {
                const Icon = option.icon;
                const isSelected = settings.theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => set({ theme: option.value })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                        : "border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
                    }`}
                  >
                    <Icon size={16} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Columns Section */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">Columns</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleResetColors}
                  className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-[11px] text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
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
                  className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                >
                  + Add column
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {sortedColumns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 p-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveColumn(col, "up")}
                      className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={idx === sortedColumns.length - 1}
                      onClick={() => moveColumn(col, "down")}
                      className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>

                  {(() => {
                    const IconComponent = ICON_MAP[col.icon];
                    if (IconComponent) {
                      return (
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">
                          <IconComponent size={14} />
                        </div>
                      );
                    }
                    // Fallback for emoji icons
                    return <span className="text-base">{col.icon}</span>;
                  })()}

                  <div className="flex-1">
                    <span className="text-sm text-gray-900 dark:text-white">{col.title}</span>
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      WIP: {col.wipLimit ?? "∞"}
                      {col.isTerminal && " • Terminal"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingColumn(col)}
                    className="rounded-lg px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white"
                  >
                    Edit
                  </button>

                  {sortedColumns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm({ column: col, migrateToId: sortedColumns.find((c) => c.id !== col.id)?.id ?? "" })}
                      className="rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
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
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">Tags</div>
                <div className="flex gap-2">
                  {onAddTagCategory && (
                    <button
                      type="button"
                      onClick={() => setEditingCategory({
                        id: "",
                        name: "New Category",
                        order: (state.tagCategories?.length ?? 0),
                      })}
                      className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-[11px] text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
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
                    className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
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
                      <div key={category.id} className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 p-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {category.name}
                          </span>
                          <div className="flex gap-1">
                            {onUpdateTagCategory && (
                              <button
                                type="button"
                                onClick={() => setEditingCategory(category)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                              >
                                Edit
                              </button>
                            )}
                            {onDeleteTagCategory && (state.tagCategories?.length ?? 0) > 1 && (
                              <button
                                type="button"
                                onClick={() => onDeleteTagCategory(category.id)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400"
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
                                className="ml-1 opacity-0 group-hover:opacity-100 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteTag(tag.id)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-600 dark:hover:text-red-400"
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
              <div className="text-sm text-gray-900 dark:text-white">Celebrations</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Subtle confetti when moving to terminal column</div>
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
              <div className="text-sm text-gray-900 dark:text-white">Reduced motion override</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Disables confetti and uses header pulse</div>
            </div>
            <input
              type="checkbox"
              checked={settings.reducedMotionOverride}
              onChange={(e) => set({ reducedMotionOverride: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </div>

          {/* Analytics Section */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Analytics</div>

            <div className="mt-3 space-y-4">
              {/* Aging WIP Indicators Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900 dark:text-white">Aging WIP indicators</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
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
                  <div className="text-sm text-gray-900 dark:text-white">Stale card threshold</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Days of inactivity before a card is considered stale
                  </div>
                </div>
                <select
                  value={settings.staleCardThreshold}
                  onChange={(e) => set({ staleCardThreshold: Number(e.target.value) as 3 | 7 | 14 })}
                  className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>

              {/* Auto Priority Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900 dark:text-white">Auto-assign priority from due dates</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
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
                  <div className="text-sm text-gray-900 dark:text-white">Stale backlog warning</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Show warning on backlog cards without due dates after this many days
                  </div>
                </div>
                <select
                  value={settings.staleBacklogThreshold}
                  onChange={(e) => set({ staleBacklogThreshold: Number(e.target.value) as 3 | 7 | 14 })}
                  className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>

              {/* Auto-Archive Toggle */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-900 dark:text-white">Auto-archive completed cards</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically archive cards in Done from previous months when the app loads
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoArchive}
                  onChange={(e) => set({ autoArchive: e.target.checked })}
                  className="h-4 w-4 accent-emerald-600"
                />
              </div>
            </div>
          </div>

          {/* Export/Import Section */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
            <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Data Management</div>
            <ExportImportPanel state={state} onImport={onImport} />
          </div>

          {/* API Tokens Section - only show when Supabase is configured */}
          {isSupabaseConfigured() && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
              <div className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">API Tokens (CLI &amp; MCP)</div>
              <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Personal access tokens let CLI tools and MCP integrations act on your behalf.
              </div>

              {noSession ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                  Sign in to create and manage API tokens.
                </div>
              ) : (
                <>
              {/* One-time token reveal box */}
              {revealedToken && (
                <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Token created — copy it now. You won&apos;t see it again.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <code
                      className="flex-1 rounded border border-amber-200 dark:border-amber-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs font-mono text-gray-800 dark:text-gray-200 break-all select-all"
                      aria-label="New API token value"
                    >
                      {revealedToken.token}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyToken(revealedToken.token)}
                      aria-label="Copy token"
                      className="shrink-0 rounded-lg border border-amber-300 dark:border-amber-600 bg-white dark:bg-gray-800 p-1.5 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setRevealedToken(null); setCopied(false); }}
                    className="mt-2 text-xs text-amber-700 dark:text-amber-400 underline hover:no-underline"
                  >
                    I&apos;ve copied it — dismiss
                  </button>
                </div>
              )}

              {/* Create token */}
              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreateToken(); }}
                  placeholder="Token name (e.g. My CLI)"
                  maxLength={100}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateToken()}
                  disabled={creatingToken || !newTokenName.trim()}
                  className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingToken ? "Creating…" : "Create token"}
                </button>
              </div>
              {createError && (
                <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {createError}
                </div>
              )}

              {/* Token list */}
              {tokensLoading && (
                <div className="text-xs text-gray-400 dark:text-gray-500">Loading tokens…</div>
              )}
              {tokensError && !tokensLoading && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {tokensError}
                </div>
              )}
              {!tokensLoading && !tokensError && tokens.length === 0 && (
                <div className="text-xs text-gray-400 dark:text-gray-500 italic">No tokens yet.</div>
              )}
              {!tokensLoading && tokens.length > 0 && (
                <div className="space-y-2">
                  {tokens.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.name}</span>
                          {t.revoked_at && (
                            <span className="shrink-0 rounded-full bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                              revoked
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                          <span>{t.scopes.join(", ")}</span>
                          <span>created {new Date(t.created_at).toLocaleDateString()}</span>
                          {t.last_used_at && (
                            <span>last used {new Date(t.last_used_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      {!t.revoked_at && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeToken(t.id)}
                          disabled={revokingId === t.id}
                          aria-label={`Revoke token ${t.name}`}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                        >
                          {revokingId === t.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
                </>
              )}
            </div>
          )}

          {/* Account Section - only show when Supabase is configured */}
          {isSupabaseConfigured() && onSignOut && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Account</div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Your data is synced to the cloud
                </div>
                <button
                  onClick={onSignOut}
                  className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-1.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
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
            className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>

      {/* Column Edit Modal */}
      {editingColumn && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center">
          <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={() => setEditingColumn(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingColumn.id ? "Edit Column" : "Add Column"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Title</label>
                <input
                  type="text"
                  value={editingColumn.title}
                  onChange={(e) => setEditingColumn({ ...editingColumn, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Icon</label>
                  <input
                    type="text"
                    value={editingColumn.icon}
                    onChange={(e) => setEditingColumn({ ...editingColumn, icon: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {DEFAULT_COLUMN_ICONS.map((iconName) => {
                      const IconComponent = ICON_MAP[iconName];
                      if (!IconComponent) return null;
                      const isSelected = editingColumn.icon === iconName;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          onClick={() => setEditingColumn({ ...editingColumn, icon: iconName })}
                          className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                              : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600"
                          }`}
                        >
                          <IconComponent size={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">Color</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="color"
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="h-10 w-10 cursor-pointer rounded border border-gray-200 dark:border-gray-600 bg-transparent"
                    />
                    <input
                      value={editingColumn.color}
                      onChange={(e) => setEditingColumn({ ...editingColumn, color: e.target.value })}
                      className="w-24 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">WIP Limit (leave empty for unlimited)</label>
                <input
                  type="number"
                  min={1}
                  value={editingColumn.wipLimit ?? ""}
                  onChange={(e) => setEditingColumn({
                    ...editingColumn,
                    wipLimit: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                  })}
                  placeholder="Unlimited"
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 placeholder:text-gray-400 dark:placeholder:text-gray-500"
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
                <label htmlFor="isTerminal" className="text-sm text-gray-900 dark:text-white">
                  Terminal column (triggers celebration)
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingColumn(null)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingColumn.id) {
                    onUpdateColumn(editingColumn);
                  } else {
                    const { id: _id, order: _order, ...rest } = editingColumn;
                    void _id;
                    void _order;
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
          <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">Delete Column</div>

            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              Are you sure you want to delete &quot;{deleteConfirm.column.title}&quot;?
            </p>

            <div className="mt-4">
              <label className="text-xs text-gray-500 dark:text-gray-400">Move existing cards to:</label>
              <select
                value={deleteConfirm.migrateToId}
                onChange={(e) => setDeleteConfirm({ ...deleteConfirm, migrateToId: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
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
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
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
          <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={() => setEditingTag(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingTag.id ? "Edit Tag" : "Add Tag"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Name</label>
                <input
                  type="text"
                  value={editingTag.name}
                  onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Category</label>
                <select
                  value={editingTag.categoryId}
                  onChange={(e) => setEditingTag({ ...editingTag, categoryId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {(state.tagCategories ?? []).map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Color</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TAG_COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEditingTag({ ...editingTag, color })}
                      className={`h-8 w-8 rounded-full border-2 transition ${
                        editingTag.color === color
                          ? "border-gray-900 dark:border-white ring-2 ring-emerald-400"
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
                    className="h-8 w-8 cursor-pointer rounded border border-gray-200 dark:border-gray-600 bg-transparent"
                  />
                  <input
                    value={editingTag.color}
                    onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                    className="w-24 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Preview</label>
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
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingTag.id) {
                    onUpdateTag(editingTag);
                  } else {
                    const { id: _id, ...rest } = editingTag;
                    void _id;
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
          <div className="absolute inset-0 bg-gray-900/30 dark:bg-gray-900/50 backdrop-blur-sm" onClick={() => setEditingCategory(null)} />
          <div className="relative w-[400px] max-w-[90vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-xl">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingCategory.id ? "Edit Category" : "Add Category"}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Name</label>
                <input
                  type="text"
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingCategory(null)}
                className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingCategory.id) {
                    onUpdateTagCategory(editingCategory);
                  } else {
                    const { id: _id, order: _order, ...rest } = editingCategory;
                    void _id;
                    void _order;
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
