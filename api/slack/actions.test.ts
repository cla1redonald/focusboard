/**
 * Tests for the Slack message-action signature verification — the security
 * boundary of the "right-click → Add to FocusBoard" endpoint. The endpoint
 * trusts Slack's HMAC over the raw body; if this is wrong, anyone could post
 * captures. (The capture insert itself mirrors the proven /api/capture path.)
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySlack } from "./actions.js";

const SECRET = "test-signing-secret";
const now = () => Math.floor(Date.now() / 1000);

function sign(body: string, ts: number, secret = SECRET): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}

describe("verifySlack", () => {
  const body = "payload=%7B%22type%22%3A%22message_action%22%7D";

  it("accepts a correctly-signed, fresh request", () => {
    const ts = now();
    expect(verifySlack(body, sign(body, ts), String(ts), SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const ts = now();
    expect(verifySlack(body, sign(body, ts, "wrong-secret"), String(ts), SECRET)).toBe(false);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const ts = now();
    const sig = sign(body, ts);
    expect(verifySlack(body + "&injected=1", sig, String(ts), SECRET)).toBe(false);
  });

  it("rejects a stale timestamp (replay protection, >5 min)", () => {
    const ts = now() - 600;
    expect(verifySlack(body, sign(body, ts), String(ts), SECRET)).toBe(false);
  });

  it("rejects a future timestamp beyond the window", () => {
    const ts = now() + 600;
    expect(verifySlack(body, sign(body, ts), String(ts), SECRET)).toBe(false);
  });

  it("rejects missing signature or timestamp", () => {
    const ts = now();
    expect(verifySlack(body, undefined, String(ts), SECRET)).toBe(false);
    expect(verifySlack(body, sign(body, ts), undefined, SECRET)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verifySlack(body, sign(body, now()), "not-a-number", SECRET)).toBe(false);
  });
});
