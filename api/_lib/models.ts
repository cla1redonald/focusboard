/**
 * Single source of truth for Anthropic model ids + a runtime self-heal wrapper.
 *
 * Why this file exists: every AI endpoint used to hardcode its own model id, so
 * when `claude-3-5-haiku-20241022` reached end-of-life the whole app 500'd and
 * each endpoint had to be fixed separately. Now there is ONE place to change a
 * model, and a wrapper that survives a model going away.
 *
 * Defense in depth against EOL'd / removed models:
 *   1. Centralised ids (here) — one edit, not six.
 *   2. createMessageHealing() — if the chosen model 404s ("not_found_error"),
 *      automatically retry with a fallback and log loudly, so users never see a
 *      500. The log line is the signal to update the id properly.
 *   3. scripts/check-models.mts — pings every id below; run in CI/manually to
 *      catch a dead or soon-deprecated model BEFORE it reaches users.
 */

import type Anthropic from "@anthropic-ai/sdk";

/** Current model ids. Update HERE when a model is deprecated. */
export const MODELS = {
  /** Cheap, fast — the default for the structured AI endpoints. */
  HAIKU: "claude-haiku-4-5-20251001",
  /** Stronger — multi-step tool use / reasoning. */
  SONNET: "claude-sonnet-4-6",
} as const;

/**
 * Ordered fallback chain used when the requested model is unavailable.
 * Keep the most broadly-available model last. The healer skips the model that
 * just failed and uses the next live one.
 */
export const MODEL_FALLBACKS: readonly string[] = [MODELS.HAIKU, MODELS.SONNET];

/** True for the Anthropic error you get when a model id is gone (EOL/removed). */
export function isModelNotFound(err: unknown): boolean {
  const e = err as { status?: number; error?: { error?: { type?: string } } };
  return e?.status === 404 && e?.error?.error?.type === "not_found_error";
}

/**
 * client.messages.create with self-heal: on a model-not-found error, retry once
 * with the next model in MODEL_FALLBACKS. Any other error propagates unchanged.
 *
 * This degrades gracefully (a dead model → a fallback answer, not a 500) while
 * emitting a loud console.error that surfaces in runtime logs as the prompt to
 * fix the id. Non-model failures (auth, rate limit, billing) are NOT healed —
 * they rethrow so the real cause isn't masked.
 */
export async function createMessageHealing(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (!isModelNotFound(err)) throw err;

    const fallback = MODEL_FALLBACKS.find((m) => m !== params.model);
    if (!fallback) throw err; // nothing else to try

    console.error(
      `[model-heal] model "${params.model}" is unavailable (not_found) — ` +
        `retrying with "${fallback}". Update its id in api/_lib/models.ts.`
    );
    return await client.messages.create({ ...params, model: fallback });
  }
}
