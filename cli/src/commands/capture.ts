import { FocusboardClient } from "../client.js";
import { info, isJson, isQuiet, printJson, paint, warn } from "../output.js";

async function readStdinLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `fb capture -` — batch mode: one item per non-empty stdin line (Phase 5a). */
async function captureBatchFromStdin(opts: { source?: string }) {
  const items = await readStdinLines();
  if (items.length === 0) {
    throw new Error("Nothing on stdin to capture — pipe one item per line into fb capture -");
  }
  if (items.length > 25) {
    throw new Error(`Too many items (${items.length}) — max 25 per batch; split the input`);
  }

  const client = new FocusboardClient();
  const result = await client.captureBatch(items, { source: opts.source });

  if (isJson()) {
    printJson(result);
    return;
  }
  if (isQuiet()) {
    for (const r of result.results) if (r.ok && r.captureId) console.log(r.captureId);
    return;
  }
  const dupes = result.results.filter((r) => r.duplicate).length;
  const failed = result.results.filter((r) => !r.ok);
  info(`${paint("✓", "green")} Captured ${result.captured}/${result.total}${dupes ? ` (${dupes} duplicate${dupes === 1 ? "" : "s"})` : ""} — in your inbox`);
  for (const f of failed) {
    warn(`item ${f.index + 1} failed: ${items[f.index]?.slice(0, 60)}`);
  }
}

export async function captureCommand(text: string[], opts: { source?: string }) {
  if (text.length === 1 && text[0] === "-") {
    return captureBatchFromStdin(opts);
  }

  const content = text.join(" ").trim();
  if (!content) {
    throw new Error("Nothing to capture — usage: fb capture \"the thought\" (or pipe lines into fb capture -)");
  }

  const client = new FocusboardClient();
  const result = await client.capture(content, { source: opts.source });

  if (isJson()) {
    printJson(result);
    return;
  }
  if (isQuiet()) {
    console.log(result.captureId);
    return;
  }
  if (result.duplicate) {
    info(`${paint("✓", "green")} Already captured (duplicate) — ${result.captureId}`);
  } else {
    info(`${paint("✓", "green")} Captured — it's in your inbox`);
  }
}
