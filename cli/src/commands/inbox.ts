import { FocusboardClient, type CaptureItem } from "../client.js";
import { saveAliases, resolveId } from "../aliases.js";
import { info, isJson, isQuiet, printJson, table, relativeTime, truncate, paint } from "../output.js";

function parsedTitle(item: CaptureItem): string {
  const title = item.parsed_cards?.[0]?.title;
  if (title) return truncate(title, 50);
  if (item.processed_at === null) return paint("(not parsed yet)", "dim");
  return paint("(no parse)", "dim");
}

export async function inboxCommand() {
  const client = new FocusboardClient();
  const { items, total } = await client.inbox();

  const aliases = saveAliases(items.map((i) => i.id));
  const aliasFor = new Map(Object.entries(aliases).map(([a, id]) => [id, a]));

  if (isJson()) {
    printJson({
      total,
      items: items.map((i) => ({ alias: aliasFor.get(i.id) ?? null, ...i })),
    });
    return;
  }
  if (isQuiet()) {
    for (const i of items) console.log(i.id);
    return;
  }
  if (items.length === 0) {
    info("Inbox zero — nothing waiting.");
    return;
  }

  // Show the AI-parsed title next to the raw text so bad parses are caught at a glance.
  table(
    items.map((i) => [
      aliasFor.get(i.id) ?? "",
      truncate(i.raw_content, 44),
      parsedTitle(i),
      i.source,
      relativeTime(i.created_at),
    ]),
    ["ID", "CAPTURED", "PARSED AS", "SOURCE", "WHEN"]
  );
  info("");
  info(paint(`${total} item${total === 1 ? "" : "s"} · fb snooze <id> · fb inbox dismiss <id>`, "dim"));
}

export async function dismissCommand(id: string) {
  const client = new FocusboardClient();
  const captureId = resolveId(id);
  const result = await client.dismiss(captureId);

  if (isJson()) {
    printJson(result);
    return;
  }
  info(`${paint("✓", "green")} Dismissed ${id}`);
}
