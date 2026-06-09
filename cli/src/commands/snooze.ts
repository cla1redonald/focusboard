import { FocusboardClient } from "../client.js";
import { resolveId } from "../aliases.js";
import { info, isJson, printJson, paint, relativeTime } from "../output.js";

const UNITS: Record<string, number> = { m: 1, h: 60, d: 60 * 24 };

/** Accept "90", "90m", "2h", "3d" — returns minutes. */
export function parseDuration(raw: string): number {
  const match = /^(\d+)\s*([mhd]?)$/i.exec(raw.trim());
  if (!match) {
    throw new Error(`Can't parse duration "${raw}" — use minutes (90), hours (2h), or days (3d)`);
  }
  const unit = (match[2] || "m").toLowerCase();
  return Number(match[1]) * (UNITS[unit] ?? 1);
}

export async function snoozeCommand(id: string, opts: { for?: string; minutes?: string }) {
  const minutes = parseDuration(opts.for ?? opts.minutes ?? "60");
  const client = new FocusboardClient();
  const captureId = resolveId(id);
  const result = await client.snooze(captureId, minutes);

  if (isJson()) {
    printJson(result);
    return;
  }
  info(`${paint("✓", "green")} Snoozed ${id} — back ${relativeTime(result.snoozedUntil)}`);
}
