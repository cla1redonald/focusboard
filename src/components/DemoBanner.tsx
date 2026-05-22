import { Sparkles, X } from "lucide-react";
import { exitDemoMode } from "../app/demoMode";

/**
 * Thin banner that surfaces "demo mode" status and offers an exit path.
 * Rendered above the main board so visitors always know data is local.
 */
export function DemoBanner({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const handleExit = () => {
    exitDemoMode();
    window.location.reload();
  };

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50/80 px-4 py-2 text-sm text-emerald-800 backdrop-blur dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200">
      <div className="flex items-center gap-2">
        <Sparkles size={14} aria-hidden />
        <span>
          <span className="font-semibold">Demo mode.</span>{" "}
          <span className="opacity-90">
            Drag cards, edit, explore. Changes save in this browser only.
          </span>
        </span>
      </div>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 px-2 py-1 text-xs font-medium transition hover:bg-emerald-100 dark:border-emerald-400/30 dark:hover:bg-emerald-900/40"
        title="Clear demo data and return to sign-in"
      >
        <X size={12} aria-hidden />
        {supabaseConfigured ? "Exit demo" : "Reset board"}
      </button>
    </div>
  );
}
