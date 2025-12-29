import React from "react";
import { Search, X, Filter } from "lucide-react";
import type { Column, DueDateFilter, FilterState, Tag } from "../app/types";
import { isFilterActive } from "../app/filters";

export function FilterBar({
  filter,
  onChange,
  columns,
  allTags,
  tagDefinitions = [],
  resultCount,
  totalCount,
}: {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  columns: Column[];
  allTags: string[];
  tagDefinitions?: Tag[];
  resultCount: number;
  totalCount: number;
}) {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = React.useState(false);

  // Keyboard shortcut for search (Cmd/Ctrl+K)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // Escape to clear search
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        onChange({ ...filter, search: "" });
        searchRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filter, onChange]);

  const hasActiveFilters = isFilterActive(filter);
  const isFiltered = resultCount !== totalCount;

  const clearAllFilters = () => {
    onChange({
      search: "",
      columns: [],
      tags: [],
      dueDate: "all",
      hasBlocker: null,
    });
  };

  const toggleColumn = (columnId: string) => {
    const newColumns = filter.columns.includes(columnId)
      ? filter.columns.filter((c) => c !== columnId)
      : [...filter.columns, columnId];
    onChange({ ...filter, columns: newColumns });
  };

  const toggleTag = (tag: string) => {
    const newTags = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
    onChange({ ...filter, tags: newTags });
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search cards... (⌘K)"
            value={filter.search}
            onChange={(e) => onChange({ ...filter, search: e.target.value })}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 pl-10 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          {filter.search && (
            <button
              onClick={() => onChange({ ...filter, search: "" })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter toggle button */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-sm transition ${
            showFilters || hasActiveFilters
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
          }`}
        >
          <Filter size={14} />
          Filters
          {hasActiveFilters && !filter.search && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-xs text-white">
              {(filter.columns.length > 0 ? 1 : 0) +
                (filter.tags.length > 0 ? 1 : 0) +
                (filter.dueDate !== "all" ? 1 : 0) +
                (filter.hasBlocker !== null ? 1 : 0)}
            </span>
          )}
        </button>

        {/* Result count */}
        {isFiltered && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>
              Showing <span className="font-medium text-gray-900">{resultCount}</span> of{" "}
              {totalCount} cards
            </span>
            <button
              onClick={clearAllFilters}
              className="text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Column filter */}
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">Columns</div>
              <div className="flex flex-wrap gap-1">
                {columns.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => toggleColumn(col.id)}
                    className={`rounded-lg px-2 py-1 text-xs transition ${
                      filter.columns.includes(col.id)
                        ? "bg-emerald-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {col.icon} {col.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Tag filter */}
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">Tags</div>
              {allTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {allTags.map((tagId) => {
                    const tagDef = tagDefinitions.find((t) => t.id === tagId);
                    const isSelected = filter.tags.includes(tagId);
                    if (tagDef) {
                      return (
                        <button
                          key={tagId}
                          onClick={() => toggleTag(tagId)}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${
                            isSelected ? "ring-2 ring-offset-1" : "opacity-70 hover:opacity-100"
                          }`}
                          style={{
                            backgroundColor: `${tagDef.color}20`,
                            color: tagDef.color,
                            ...(isSelected ? { ringColor: tagDef.color } : {}),
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tagDef.color }}
                          />
                          {tagDef.name}
                        </button>
                      );
                    }
                    // Fallback for unknown tag IDs
                    return (
                      <button
                        key={tagId}
                        onClick={() => toggleTag(tagId)}
                        className={`rounded-lg px-2 py-1 text-xs transition ${
                          isSelected
                            ? "bg-emerald-500 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {tagId}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-400">No tags found</div>
              )}
            </div>

            {/* Due date filter */}
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">Due Date</div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { value: "all", label: "All" },
                    { value: "overdue", label: "Overdue" },
                    { value: "today", label: "Today" },
                    { value: "this-week", label: "This week" },
                    { value: "no-date", label: "No date" },
                  ] as { value: DueDateFilter; label: string }[]
                ).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onChange({ ...filter, dueDate: option.value })}
                    className={`rounded-lg px-2 py-1 text-xs transition ${
                      filter.dueDate === option.value
                        ? "bg-emerald-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Blocker filter */}
            <div>
              <div className="mb-2 text-xs font-medium text-gray-500">Blockers</div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { value: null, label: "All" },
                    { value: true, label: "Blocked" },
                    { value: false, label: "Not blocked" },
                  ] as { value: boolean | null; label: string }[]
                ).map((option) => (
                  <button
                    key={String(option.value)}
                    onClick={() => onChange({ ...filter, hasBlocker: option.value })}
                    className={`rounded-lg px-2 py-1 text-xs transition ${
                      filter.hasBlocker === option.value
                        ? "bg-emerald-500 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
