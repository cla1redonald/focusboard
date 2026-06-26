import React from "react";
import { Sparkles, Loader2, ArrowRight, Check, AlertCircle } from "lucide-react";
import type { Column, Tag } from "../app/types";
import { useAI, type AgentCommandResult } from "../app/useAI";

/**
 * Natural-language board command bar.
 *
 * Sends a free-text instruction to the server-side agent (POST /api/ai/agent),
 * which runs a Claude tool-use loop and mutates the board. Card changes flow
 * back into the UI via the existing Supabase realtime subscription, so there's
 * no manual refresh here — we just surface what the agent did.
 *
 * Examples:
 *   "move my two high-priority design cards to To Do"
 *   "add a card to prep the Q3 deck, due Friday, tagged high"
 */
export function CommandBar({
  columns,
  tagDefinitions = [],
}: {
  columns: Column[];
  tagDefinitions?: Tag[];
}) {
  const { runBoardCommand, isLoading, error } = useAI({
    availableTags: tagDefinitions,
    availableColumns: columns,
  });
  const [instruction, setInstruction] = React.useState("");
  const [result, setResult] = React.useState<AgentCommandResult | null>(null);

  const handleSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!instruction.trim() || isLoading) return;
      setResult(null);
      const res = await runBoardCommand(instruction);
      if (res) {
        setResult(res);
        setInstruction("");
      }
    },
    [instruction, isLoading, runBoardCommand]
  );

  const okCount = result?.steps.filter((s) => s.ok).length ?? 0;
  const failCount = result?.steps.filter((s) => !s.ok).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-500" />
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isLoading}
            maxLength={1000}
            placeholder="Tell the board what to do — e.g. “move my high-priority design cards to To Do”"
            aria-label="Natural-language board command"
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-violet-900/40"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !instruction.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isLoading ? "Working…" : "Run"}
        </button>
      </form>

      {error && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm dark:border-gray-800 dark:bg-gray-900/40">
          <p className="text-gray-800 dark:text-gray-200">{result.summary}</p>
          {result.steps.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {okCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <Check className="h-3 w-3" />
                  {okCount} action{okCount === 1 ? "" : "s"}
                </span>
              )}
              {failCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <AlertCircle className="h-3 w-3" />
                  {failCount} failed
                </span>
              )}
              {result.stoppedAtCap && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  hit action limit
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
