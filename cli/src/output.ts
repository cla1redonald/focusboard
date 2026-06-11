import { ApiError } from "./client.js";

/**
 * Output helpers for the fb CLI.
 *
 * Conventions (from the operator-UX review):
 *   - "Error:" prefix = blocking; "Warning:" = degraded but the command worked;
 *     no prefix = info. Never raw stack traces. Always a next-action hint when
 *     one exists.
 *   - Monochrome-safe: colour is decoration only. Disabled when NO_COLOR is set,
 *     stdout is not a TTY, or --no-color was passed.
 *   - --quiet prints only the essential machine-usable line.
 */

let colorEnabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
let quiet = false;
let json = false;

export function configureOutput(opts: { noColor?: boolean; quiet?: boolean; json?: boolean }) {
  if (opts.noColor) colorEnabled = false;
  quiet = opts.quiet ?? false;
  json = opts.json ?? false;
}

export function isQuiet(): boolean {
  return quiet;
}

export function isJson(): boolean {
  return json;
}

const codes = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, cyan: 36 } as const;

export function paint(text: string, color: keyof typeof codes): string {
  if (!colorEnabled) return text;
  return `[${codes[color]}m${text}[0m`;
}

export function info(message: string) {
  if (!quiet && !json) console.log(message);
}

export function warn(message: string) {
  if (!json) console.error(`${paint("Warning:", "yellow")} ${message}`);
}

/** Print a blocking error (+ optional hint) and return exit code 1. */
export function printError(err: unknown): number {
  let message: string;
  let hint: string | undefined;
  if (err instanceof ApiError) {
    message = err.message;
    hint = err.hint;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  if (json) {
    console.error(JSON.stringify({ ok: false, error: { message, ...(hint ? { hint } : {}) } }));
  } else {
    console.error(`${paint("Error:", "red")} ${message}`);
    if (hint) console.error(`  ${paint(hint, "dim")}`);
  }
  return 1;
}

export function printJson(data: unknown) {
  console.log(JSON.stringify({ ok: true, data }, null, 2));
}

/** Minimal table: pads columns to fit; no borders (monochrome-safe). */
export function table(rows: string[][], header?: string[]) {
  const all = header ? [header, ...rows] : rows;
  if (all.length === 0) return;
  const first = all[0]!;
  const widths = first.map((_, col) =>
    Math.max(...all.map((r) => (r[col] ?? "").length))
  );
  const render = (r: string[], dim = false) => {
    const line = r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
    return dim ? paint(line, "dim") : line;
  };
  if (header) console.log(render(header, true));
  for (const r of rows) console.log(render(r));
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60_000);
  const future = mins < 0;
  const m = Math.abs(mins);
  let span: string;
  if (m < 1) span = "now";
  else if (m < 60) span = `${m}m`;
  else if (m < 60 * 24) span = `${Math.round(m / 60)}h`;
  else span = `${Math.round(m / (60 * 24))}d`;
  if (span === "now") return span;
  return future ? `in ${span}` : `${span} ago`;
}

export function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}
