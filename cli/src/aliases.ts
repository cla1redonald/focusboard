import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.js";

/**
 * Short aliases for capture IDs (cap-1, cap-2, …).
 *
 * `fb inbox` numbers the rows it shows and persists the alias → UUID map; a later
 * `fb snooze cap-2` resolves through the map. The CLI always sends FULL IDs to the
 * API; aliases exist only in human-facing input/output. `--json` output always
 * carries the full IDs.
 */

const FILE = "aliases.json";

export function saveAliases(ids: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  ids.forEach((id, i) => {
    map[`cap-${i + 1}`] = id;
  });
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(join(configDir(), FILE), JSON.stringify(map, null, 2) + "\n");
  } catch {
    // Aliases are a convenience — failing to persist them must not fail the command.
  }
  return map;
}

export function loadAliases(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(configDir(), FILE), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Resolve a user-supplied ID: a cap-N alias from the last `fb inbox`, or a full
 * UUID passed through unchanged. Unknown aliases throw with a next-action hint.
 */
export function resolveId(input: string): string {
  if (/^cap-\d+$/i.test(input)) {
    const map = loadAliases();
    const id = map[input.toLowerCase()];
    if (!id) {
      throw new Error(
        `Unknown alias "${input}" — run \`fb inbox\` first to refresh aliases, or pass the full capture ID`
      );
    }
    return id;
  }
  return input;
}
