import { FocusboardClient } from "../client.js";
import { resolveId } from "../aliases.js";
import { info, isJson, isQuiet, printJson, paint } from "../output.js";

/**
 * Phase 4a — card mutation: fb add | move | done | block.
 *
 * Mutations follow the read-then-CAS discipline: fetch the card fresh, send its
 * version with the mutation. If something else changed the card in between, the
 * API answers 409 STALE_STATE and the error hint says to re-run — no silent
 * clobbers, ever.
 */

function parseDue(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (lower === "today") return day(0);
  if (lower === "tomorrow") return day(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw new Error(`Can't parse due date "${raw}" — use today, tomorrow, or YYYY-MM-DD`);
}

export async function addCommand(
  text: string[],
  opts: { column?: string; swimlane?: string; due?: string; tag?: string[]; notes?: string }
) {
  const title = text.join(" ").trim();
  if (!title) throw new Error('Nothing to add — usage: fb add "Draft the proposal" [--column doing]');

  const client = new FocusboardClient();
  const { card } = await client.cardAdd({
    title,
    ...(opts.column ? { column: opts.column } : {}),
    ...(opts.swimlane ? { swimlane: opts.swimlane } : {}),
    ...(parseDue(opts.due) ? { dueDate: parseDue(opts.due) } : {}),
    ...(opts.tag?.length ? { tags: opts.tag } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });

  if (isJson()) {
    printJson({ card });
    return;
  }
  if (isQuiet()) {
    console.log(card.id);
    return;
  }
  info(`${paint("✓", "green")} Added "${card.title}" to ${card.column} (${card.swimlane})`);
}

async function freshVersion(client: FocusboardClient, idOrAlias: string): Promise<{ id: string; version: number | null; title: string }> {
  const id = resolveId(idOrAlias);
  const { card } = await client.cardGet(id);
  return { id, version: card.version, title: card.title };
}

export async function moveCommand(idOrAlias: string, column: string) {
  const client = new FocusboardClient();
  const { id, version, title } = await freshVersion(client, idOrAlias);
  const { card } = await client.cardMove(id, version, column);

  if (isJson()) {
    printJson({ card });
    return;
  }
  info(`${paint("✓", "green")} Moved "${title}" → ${card.column}`);
}

export async function doneCommand(idOrAlias: string) {
  const client = new FocusboardClient();
  const { id, version, title } = await freshVersion(client, idOrAlias);
  const { card } = await client.cardDone(id, version);

  if (isJson()) {
    printJson({ card });
    return;
  }
  info(`${paint("✓", "green")} Done — "${title}" → ${card.column}`);
}

export async function blockCommand(idOrAlias: string, opts: { reason?: string }) {
  const reason = opts.reason?.trim();
  if (!reason) throw new Error('A reason is required — fb block c-2 --reason "waiting on devops"');

  const client = new FocusboardClient();
  const { id, version, title } = await freshVersion(client, idOrAlias);
  // Two steps, CAS carried through: set the reason, then move to blocked with
  // the version the patch returned.
  const { card: patched } = await client.cardPatch(id, version, { blockedReason: reason });
  const { card } = await client.cardMove(id, patched.version, "blocked");

  if (isJson()) {
    printJson({ card });
    return;
  }
  info(`${paint("■", "red")} Blocked "${title}" — ${reason}`);
}
