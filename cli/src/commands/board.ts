import { FocusboardClient, type SlimCard } from "../client.js";
import { saveAliases } from "../aliases.js";
import { info, isJson, isQuiet, printJson, table, paint, truncate } from "../output.js";

/** Phase 2 — read-only board commands: fb today | list | search | wip. */

function dueLabel(card: SlimCard): string {
  if (!card.dueDate) return "";
  const key = card.dueDate.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (key < today) return paint(`${key} (overdue)`, "red");
  if (key === today) return paint("today", "yellow");
  return key;
}

function cardRow(card: SlimCard, alias: string): string[] {
  return [
    alias,
    truncate(card.title, 46),
    card.column,
    card.swimlane,
    dueLabel(card),
    card.tags.join(","),
  ];
}

function aliasMap(cards: SlimCard[]): Map<string, string> {
  const fresh = saveAliases(cards.map((c) => c.id), "c");
  return new Map(Object.entries(fresh).map(([alias, id]) => [id, alias]));
}

export async function todayCommand() {
  const client = new FocusboardClient();
  const data = await client.today();

  if (isJson()) {
    printJson(data);
    return;
  }

  const allCards: SlimCard[] = [
    ...(data.dailyPlan.main ? [data.dailyPlan.main] : []),
    ...data.dailyPlan.support,
    ...data.recommendations.map((r) => r.card),
    ...data.attention.overdue,
    ...data.attention.dueToday,
    ...data.attention.blocked,
  ];
  const seen = new Set<string>();
  const unique = allCards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const aliases = aliasMap(unique);

  info(paint(`Today — ${data.date} · ${data.activeCount} active cards`, "cyan"));
  info("");

  if (data.dailyPlan.plannedCount > 0) {
    info(`Daily plan (${data.dailyPlan.completedCount}/${data.dailyPlan.plannedCount} done):`);
    if (data.dailyPlan.main) {
      info(`  ★ ${aliases.get(data.dailyPlan.main.id)}  ${data.dailyPlan.main.title}`);
    }
    for (const card of data.dailyPlan.support) {
      info(`  · ${aliases.get(card.id)}  ${card.title}`);
    }
    info("");
  }

  if (data.recommendations.length > 0) {
    info("Recommended focus:");
    data.recommendations.forEach((r, i) => {
      info(`  ${i + 1}. ${aliases.get(r.card.id)}  ${truncate(r.card.title, 50)}  ${paint(r.reasons.join(" · "), "dim")}`);
    });
    info("");
  }

  const a = data.attention;
  const counts = [
    a.overdue.length && paint(`${a.overdue.length} overdue`, "red"),
    a.dueToday.length && `${a.dueToday.length} due today`,
    a.blocked.length && `${a.blocked.length} blocked`,
    a.stale.length && paint(`${a.stale.length} stale`, "dim"),
  ].filter(Boolean) as string[];
  if (counts.length) info(`Attention: ${counts.join(" · ")}`);

  for (const p of data.wipPressure) {
    info(paint(`WIP pressure: ${p.columnTitle} ${p.count}/${p.limit}`, "yellow"));
  }
  if (!counts.length && !data.wipPressure.length && data.recommendations.length === 0) {
    info("All clear — nothing demanding attention.");
  }
}

export async function listCommand(opts: { status?: string; swimlane?: string; q?: string; limit?: string }) {
  const client = new FocusboardClient();
  const data = await client.cards({
    column: opts.status,
    swimlane: opts.swimlane,
    q: opts.q,
    limit: opts.limit ? Number(opts.limit) : undefined,
  });

  if (isJson()) {
    const aliases = aliasMap(data.items);
    printJson({
      ...data,
      items: data.items.map((c) => ({ alias: aliases.get(c.id) ?? null, ...c })),
    });
    return;
  }
  if (isQuiet()) {
    for (const c of data.items) console.log(c.id);
    return;
  }
  if (data.items.length === 0) {
    info(opts.q ? `No cards match "${opts.q}".` : "No cards.");
    return;
  }

  const aliases = aliasMap(data.items);
  table(
    data.items.map((c) => cardRow(c, aliases.get(c.id) ?? "")),
    ["ID", "TITLE", "COLUMN", "LANE", "DUE", "TAGS"]
  );
  info("");
  info(paint(`${data.total} card${data.total === 1 ? "" : "s"}${data.total > data.items.length ? ` (showing ${data.items.length})` : ""}`, "dim"));
}

export async function searchCommand(query: string[], opts: { status?: string; swimlane?: string }) {
  const q = query.join(" ").trim();
  if (!q) throw new Error('Nothing to search — usage: fb search "invoice"');
  await listCommand({ ...opts, q });
}

export async function wipCommand() {
  const client = new FocusboardClient();
  const data = await client.wip();

  if (isJson()) {
    printJson(data);
    return;
  }

  table(
    data.columns
      .filter((col) => !col.isTerminal)
      .map((col) => {
        const limit = col.limit === null ? "—" : String(col.limit);
        const state = col.atLimit ? paint("AT LIMIT", "red") : "";
        return [col.title, `${col.count}/${limit}`, state];
      }),
    ["COLUMN", "WIP", ""]
  );
  info("");
  info(paint(`${data.activeCount} active cards`, "dim"));
}
