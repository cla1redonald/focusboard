import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";

/**
 * Short aliases for IDs shown in tables: captures get cap-1, cap-2, … (from
 * `fb inbox`); cards get c-1, c-2, … (from `fb list` / `fb search` / `fb today`).
 *
 * Listing commands number the rows they show and persist the alias → ID map; a
 * later `fb snooze cap-2` (or, in Phase 3+, `fb focus start c-4`) resolves
 * through the map. The CLI always sends FULL IDs to the API — aliases exist only
 * in human-facing input/output. `--json` output always carries the full IDs.
 *
 * The two prefixes live in one file but are saved independently: refreshing the
 * card list does not invalidate capture aliases, and vice versa.
 */

const FILE = "aliases.json";
const PREFIXES = ["cap", "c"] as const;
export type AliasPrefix = (typeof PREFIXES)[number];

function aliasPath(): string {
  return join(configDir(), FILE);
}

function readAll(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(aliasPath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveAliases(ids: string[], prefix: AliasPrefix = "cap"): Record<string, string> {
  const existing = readAll();
  // Drop this prefix's old entries; keep the other prefix's intact.
  const kept = Object.fromEntries(
    Object.entries(existing).filter(([alias]) => !alias.startsWith(`${prefix}-`))
  );
  const fresh: Record<string, string> = {};
  ids.forEach((id, i) => {
    fresh[`${prefix}-${i + 1}`] = id;
  });
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(aliasPath(), JSON.stringify({ ...kept, ...fresh }, null, 2) + "\n");
  } catch {
    // Aliases are a convenience — failing to persist them must not fail the command.
  }
  return fresh;
}

export function loadAliases(): Record<string, string> {
  return readAll();
}

/**
 * Resolve a user-supplied ID: a cap-N / c-N alias from the last listing, or a
 * full ID passed through unchanged. Unknown aliases throw with a next-action hint.
 */
const ALIAS_RE = new RegExp(`^(${PREFIXES.join("|")})-\\d+$`, "i");

export function resolveId(input: string): string {
  const match = ALIAS_RE.exec(input);
  if (match) {
    const map = readAll();
    const id = map[input.toLowerCase()];
    if (!id) {
      const refresh = match[1]!.toLowerCase() === "cap" ? "fb inbox" : "fb list";
      throw new Error(
        `Unknown alias "${input}" — run \`${refresh}\` first to refresh aliases, or pass the full ID`
      );
    }
    return id;
  }
  return input;
}
