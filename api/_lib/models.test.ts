/**
 * Tests for the model self-heal wrapper (api/_lib/models.ts).
 *
 * The whole point: a dead/EOL model id (Anthropic 404 not_found_error) must NOT
 * 500 the endpoint — it should transparently fall back to a live model and log.
 * Non-model errors must propagate untouched (don't mask auth/billing failures).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createMessageHealing, isModelNotFound, MODELS } from "./models.js";

function notFound(model: string) {
  return {
    status: 404,
    error: { error: { type: "not_found_error", message: `model: ${model}` } },
  };
}

const baseParams = {
  model: MODELS.HAIKU,
  max_tokens: 10,
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("isModelNotFound", () => {
  it("detects the Anthropic model-not-found shape", () => {
    expect(isModelNotFound(notFound("x"))).toBe(true);
    expect(isModelNotFound({ status: 401 })).toBe(false);
    expect(isModelNotFound({ status: 404, error: { error: { type: "overloaded_error" } } })).toBe(false);
    expect(isModelNotFound(new Error("boom"))).toBe(false);
  });
});

describe("createMessageHealing", () => {
  let create: ReturnType<typeof vi.fn>;
  let client: Anthropic;

  beforeEach(() => {
    create = vi.fn();
    client = { messages: { create } } as unknown as Anthropic;
  });

  it("passes through on success (no fallback)", async () => {
    create.mockResolvedValueOnce({ id: "msg_1", model: MODELS.HAIKU });
    const res = await createMessageHealing(client, baseParams);
    expect(res).toEqual({ id: "msg_1", model: MODELS.HAIKU });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back to another model when the requested one is gone", async () => {
    create
      .mockRejectedValueOnce(notFound(MODELS.HAIKU)) // primary EOL'd
      .mockResolvedValueOnce({ id: "msg_2", model: MODELS.SONNET });
    const res = await createMessageHealing(client, baseParams);
    expect(res).toEqual({ id: "msg_2", model: MODELS.SONNET });
    expect(create).toHaveBeenCalledTimes(2);
    // second attempt used a DIFFERENT model than the one that failed
    expect(create.mock.calls[1][0].model).not.toBe(MODELS.HAIKU);
  });

  it("does NOT heal non-model errors (auth/billing/rate-limit propagate)", async () => {
    const authErr = { status: 401, error: { error: { type: "authentication_error" } } };
    create.mockRejectedValueOnce(authErr);
    await expect(createMessageHealing(client, baseParams)).rejects.toBe(authErr);
    expect(create).toHaveBeenCalledTimes(1); // no retry
  });
});
