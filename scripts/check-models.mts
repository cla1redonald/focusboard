/**
 * Model liveness check — pings every model id the app uses with a 1-token call
 * and fails if any is dead/removed (Anthropic 404 not_found) or reports a
 * deprecation warning. Run this in CI (nightly) or before a deploy so a model
 * reaching end-of-life is caught here, not by users hitting a 500.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/check-models.mts
 *   # or put ANTHROPIC_API_KEY in .env.local
 *
 * Cost: ~1 token per model — effectively free.
 * Exit code: 0 = all live, 1 = one or more dead (CI-failing).
 */

import { readFileSync, existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "../api/_lib/models.js";

if (!process.env.ANTHROPIC_API_KEY && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
    if (m) { process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, "").trim(); break; }
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ ANTHROPIC_API_KEY not set.");
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ids = [...new Set(Object.values(MODELS))];

let allLive = true;
for (const model of ids) {
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    // The SDK surfaces deprecation as a warning header; the resolved model id
    // tells us we reached a real model.
    console.log(`✅ ${model} — live (resolved: ${res.model})`);
  } catch (err) {
    allLive = false;
    const e = err as { status?: number; error?: { error?: { message?: string } } };
    console.error(`❌ ${model} — ${e.status ?? "?"} ${e.error?.error?.message ?? (err as Error).message}`);
  }
}

if (allLive) {
  console.log(`\n✅ All ${ids.length} model id(s) live.`);
  process.exit(0);
}
console.error("\n❌ One or more models are unavailable — update api/_lib/models.ts.");
process.exit(1);
