import React from "react";
import type { AppState } from "../app/types";
import {
  exportToJson,
  exportToCsv,
  downloadFile,
  validateImportData,
  mergeImportData,
  type ImportMode,
  type ImportValidationResult,
} from "../app/exportImport";

export function ExportImportPanel({
  state,
  onImport,
}: {
  state: AppState;
  onImport: (newState: AppState, mode: ImportMode) => void;
}) {
  const [importMode, setImportMode] = React.useState<ImportMode>("replace");
  const [validation, setValidation] = React.useState<ImportValidationResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExportJson = () => {
    const content = exportToJson(state);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(content, `focusboard-backup-${date}.json`, "application/json");
  };

  const handleExportCsv = () => {
    const content = exportToCsv(state.cards, state.columns);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(content, `focusboard-cards-${date}.csv`, "text/csv");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = validateImportData(content);
      setValidation(result);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!validation?.valid || !validation.data) return;

    if (importMode === "replace") {
      onImport(validation.data, "replace");
    } else {
      const merged = mergeImportData(state, validation.data);
      onImport(merged, "merge");
    }

    // Reset state
    setValidation(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCancel = () => {
    setValidation(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-amber-950">Export Data</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-2 rounded-xl border border-amber-700/20 bg-white px-4 py-2 text-sm text-amber-900 transition hover:border-amber-700/40 hover:bg-amber-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Export JSON (Full Backup)
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-xl border border-amber-700/20 bg-white px-4 py-2 text-sm text-amber-900 transition hover:border-amber-700/40 hover:bg-amber-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Export CSV (Cards Only)
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-900/60">
          JSON includes all data (cards, columns, templates, settings). CSV exports cards only for spreadsheet use.
        </p>
      </div>

      {/* Import Section */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-amber-950">Import Data</h3>

        {!validation ? (
          <div>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-amber-700/30 bg-amber-50/50 px-4 py-6 text-sm text-amber-900 transition hover:border-amber-700/50 hover:bg-amber-50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              <span>Click to select a JSON file to import</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
            <p className="mt-2 text-xs text-amber-900/60">
              Import a previously exported JSON backup file.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-700/15 bg-white p-4">
            {/* Validation Results */}
            {!validation.valid ? (
              <div>
                <div className="mb-3 flex items-center gap-2 text-rose-700">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" x2="9" y1="9" y2="15" />
                    <line x1="9" x2="15" y1="9" y2="15" />
                  </svg>
                  <span className="font-medium">Import validation failed</span>
                </div>
                <ul className="space-y-1 text-sm text-rose-600">
                  {validation.errors.map((error, i) => (
                    <li key={i}>- {error}</li>
                  ))}
                </ul>
                <button
                  onClick={handleCancel}
                  className="mt-4 rounded-xl border border-amber-700/20 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-2 text-amber-700">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                  <span className="font-medium">File validated successfully</span>
                </div>

                {/* Stats */}
                {validation.stats && (
                  <div className="mb-4 flex gap-4 text-sm text-amber-900/70">
                    <div>
                      <span className="font-medium text-amber-950">{validation.stats.cardCount}</span> cards
                    </div>
                    <div>
                      <span className="font-medium text-amber-950">{validation.stats.columnCount}</span> columns
                    </div>
                    <div>
                      <span className="font-medium text-amber-950">{validation.stats.templateCount}</span> templates
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {validation.warnings.length > 0 && (
                  <div className="mb-4 rounded-lg bg-amber-50 p-3">
                    <div className="mb-1 text-xs font-medium text-amber-800">Warnings:</div>
                    <ul className="space-y-1 text-xs text-amber-700">
                      {validation.warnings.map((warning, i) => (
                        <li key={i}>- {warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Import Mode */}
                <div className="mb-4">
                  <div className="mb-2 text-xs font-medium text-amber-900/70">Import Mode:</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setImportMode("replace")}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        importMode === "replace"
                          ? "bg-amber-600 text-white"
                          : "border border-amber-700/20 bg-white text-amber-900 hover:bg-amber-50"
                      }`}
                    >
                      Replace All
                    </button>
                    <button
                      onClick={() => setImportMode("merge")}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        importMode === "merge"
                          ? "bg-amber-600 text-white"
                          : "border border-amber-700/20 bg-white text-amber-900 hover:bg-amber-50"
                      }`}
                    >
                      Merge (Add New)
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-amber-900/60">
                    {importMode === "replace"
                      ? "Replace will overwrite all existing data with the imported data."
                      : "Merge will add new cards, columns, and templates without affecting existing ones."}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={handleCancel}
                    className="rounded-xl border border-amber-700/20 bg-white px-4 py-2 text-sm text-amber-900 hover:bg-amber-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImport}
                    className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    {importMode === "replace" ? "Replace All Data" : "Merge Data"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
