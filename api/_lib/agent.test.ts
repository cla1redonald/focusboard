/**
 * Tests for the board command agent's tool-use LOOP (api/_lib/agent.ts).
 *
 * These exercise the hand-rolled loop mechanics — read a tool_use, execute it,
 * feed a tool_result back, call the API again, stop on end_turn — without a real
 * Anthropic call or a real DB. We inject:
 *   - a fake `client` whose messages.create returns a scripted sequence, and
 *   - a fake `app` whose .fetch() returns ok-envelope responses (what the
 *     in-process executor dispatches against).
 *
 * What's verified:
 *   - a tool_use turn runs the mutation and is recorded in `steps`
 *   - the tool_result is fed back and the loop continues to the final summary
 *   - stop_reason: end_turn ends the loop (stoppedAtCap === false)
 *   - a failing tool surfaces as is_error and steps[].ok === false, loop continues
 *   - MAX_STEPS caps the loop (stoppedAtCap === true)
 */

import { describe, it, expect, vi } from "vitest";
import { runBoardAgent } from "./agent.js";

// Build a fake Anthropic message response.
function asst(content: unknown[], stop_reason: string) {
  return { content, stop_reason } as never;
}
function textBlock(text: string) {
  return { type: "text", text };
}
function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use", id, name, input };
}

// A fake app whose fetch always returns an ok envelope (the executor reads .data).
function fakeApp(impl?: (req: Request) => Response) {
  return {
    fetch: vi.fn(
      impl ??
        (() => new Response(JSON.stringify({ ok: true, data: { card: { id: "c1", version: 1 } } }), { status: 200 }))
    ),
  } as never;
}

describe("runBoardAgent — tool-use loop", () => {
  it("executes a mutation, feeds the result back, and returns the final summary", async () => {
    const create = vi
      .fn()
      // Turn 1: ask to add a card.
      .mockResolvedValueOnce(asst([toolUse("t1", "add_card", { title: "Prep Q3 deck" })], "tool_use"))
      // Turn 2: done.
      .mockResolvedValueOnce(asst([textBlock("Added “Prep Q3 deck” to backlog.")], "end_turn"));

    const result = await runBoardAgent({
      app: fakeApp(),
      authHeader: "Bearer fb_pat_x",
      userId: "u1",
      instruction: "add a card to prep the Q3 deck",
      client: { messages: { create } } as never,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain("Prep Q3 deck");
    expect(result.stoppedAtCap).toBe(false);
    expect(result.steps).toEqual([{ tool: "add_card", args: { title: "Prep Q3 deck" }, ok: true }]);

    // The second API call must include a tool_result for t1 (the loop fed it back).
    const secondCallMessages = create.mock.calls[1][0].messages;
    const toolResultMsg = secondCallMessages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result"
    );
    expect(toolResultMsg).toBeTruthy();
    expect(toolResultMsg.content[0].tool_use_id).toBe("t1");
  });

  it("surfaces a failing tool as is_error and keeps going", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(asst([toolUse("t1", "move_card", { card_id: "nope", column: "todo" })], "tool_use"))
      .mockResolvedValueOnce(asst([textBlock("Couldn't move that card — it doesn't exist.")], "end_turn"));

    // App returns a 404 error envelope → executor throws → loop records failure.
    const app = fakeApp(
      () => new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Card not found" } }), { status: 404 })
    );

    const result = await runBoardAgent({
      app,
      authHeader: "Bearer fb_pat_x",
      userId: "u1",
      instruction: "move the missing card",
      client: { messages: { create } } as never,
    });

    expect(result.steps[0].ok).toBe(false);
    // move_card pre-reads a fresh version (the CAS contract) which throws first,
    // so the surfaced message is the not-found read failure — either way the loop
    // records ok:false and keeps going.
    expect(result.steps[0].error).toMatch(/not found/i);
    expect(result.stoppedAtCap).toBe(false);

    // Locate the tool_result by find (the messages array is shared-by-reference
    // across mock calls and keeps mutating, so positional access is unreliable).
    const toolResultMsg = create.mock.calls[1][0].messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result"
    );
    expect(toolResultMsg.content[0].is_error).toBe(true);
  });

  it("stops at MAX_STEPS if the model never finishes", async () => {
    // Always ask for another tool — never returns end_turn.
    const create = vi.fn().mockResolvedValue(asst([toolUse("t", "add_card", { title: "loop" })], "tool_use"));

    const result = await runBoardAgent({
      app: fakeApp(),
      authHeader: "Bearer fb_pat_x",
      userId: "u1",
      instruction: "go forever",
      client: { messages: { create } } as never,
    });

    expect(result.stoppedAtCap).toBe(true);
    expect(create).toHaveBeenCalledTimes(10); // MAX_STEPS
    expect(result.summary).toMatch(/action limit/i);
  });
});
