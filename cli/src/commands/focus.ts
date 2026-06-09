import { FocusboardClient, type FocusOutcome } from "../client.js";
import { resolveId } from "../aliases.js";
import { parseDuration } from "./snooze.js";
import { info, isJson, printJson, paint, relativeTime } from "../output.js";

/** Phase 3 — focus sessions: fb focus start | stop | status. */

const OUTCOMES: FocusOutcome[] = ["progressed", "blocked", "completed", "abandoned"];

function elapsedLabel(startedAt: string, plannedMinutes: number): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000));
  const over = mins > plannedMinutes;
  const base = `${mins}/${plannedMinutes}m`;
  return over ? paint(`${base} (over)`, "yellow") : base;
}

export async function focusStartCommand(cardId: string | undefined, opts: { for?: string }) {
  const client = new FocusboardClient();
  const plannedMinutes = opts.for ? parseDuration(opts.for) : 25;
  const result = await client.focusStart({
    ...(cardId ? { cardId: resolveId(cardId) } : {}),
    plannedMinutes,
  });

  if (isJson()) {
    printJson(result);
    return;
  }
  const what = result.cardTitle ? `on "${result.cardTitle}"` : "(no card)";
  info(`${paint("●", "green")} Focus started ${what} — ${result.plannedMinutes}m planned`);
  info(paint("fb focus stop --outcome progressed|blocked|completed|abandoned when done", "dim"));
}

export async function focusStopCommand(opts: { outcome?: string; note?: string }) {
  const outcome = (opts.outcome ?? "progressed") as FocusOutcome;
  if (!OUTCOMES.includes(outcome)) {
    throw new Error(`Unknown outcome "${opts.outcome}" — use ${OUTCOMES.join(" | ")}`);
  }

  const client = new FocusboardClient();
  const result = await client.focusStop({ outcome, note: opts.note });

  if (isJson()) {
    printJson(result);
    return;
  }
  const what = result.cardTitle ? `"${result.cardTitle}"` : "session";
  const mark = outcome === "completed" ? paint("✓", "green") : outcome === "blocked" ? paint("■", "red") : paint("●", "cyan");
  info(`${mark} Stopped ${what} — ${result.actualMinutes}m focused (${outcome})`);
}

export async function focusStatusCommand() {
  const client = new FocusboardClient();
  const status = await client.focusStatus();

  if (isJson()) {
    printJson(status);
    return;
  }

  if (status.active) {
    const what = status.active.cardTitle ? `"${status.active.cardTitle}"` : "(no card)";
    info(`${paint("●", "green")} Focusing ${what} — ${elapsedLabel(status.active.startedAt, status.active.plannedMinutes)}, started ${relativeTime(status.active.startedAt)}`);
  } else {
    info("No active focus session.");
  }
  info(paint(`Today: ${status.today.sessions} session${status.today.sessions === 1 ? "" : "s"} · ${status.today.focusedMinutes}m focused`, "dim"));
}
