import { FocusboardClient } from "../client.js";
import { info, isJson, isQuiet, printJson, paint } from "../output.js";

export async function captureCommand(text: string[], opts: { source?: string }) {
  const content = text.join(" ").trim();
  if (!content) {
    throw new Error("Nothing to capture — usage: fb capture \"the thought\"");
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
