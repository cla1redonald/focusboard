import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual, createHash } from "crypto";

/**
 * Slack message-action endpoint — "right-click a message → Add to FocusBoard".
 *
 * A STANDALONE Vercel function (not a Hono route) ON PURPOSE: Slack signs the
 * EXACT raw request bytes for HMAC verification, and the Hono adapter
 * re-encodes form bodies (it must, to fix a separate bug), which would change
 * the bytes and break the signature. With `bodyParser: false` we read the raw
 * stream and verify against Slack's signature exactly.
 *
 * Flow: Slack POSTs an `application/x-www-form-urlencoded` body with a single
 * `payload` field (URL-encoded JSON, type `message_action`). We verify the
 * Slack signature + timestamp freshness, extract the message text, and insert
 * a capture for FOCUSBOARD_USER_ID (source: slack), idempotent on the message.
 *
 * Setup: create a Slack app with a Message Shortcut whose Request URL is this
 * endpoint; put its Signing Secret in SLACK_SIGNING_SECRET (Vercel env).
 */

export const config = { api: { bodyParser: false } };

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Verify Slack's v0 request signature over the raw body. Exported for tests. */
export function verifySlack(rawBody: string, signature: string | undefined, timestamp: string | undefined, secret: string): boolean {
  if (!signature || !timestamp) return false;
  // Reject stale requests (replay protection) — 5-minute window.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const userId = process.env.FOCUSBOARD_USER_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!signingSecret || !userId || !supabaseUrl || !serviceKey) {
    res.status(500).json({ error: "Slack capture not configured" });
    return;
  }

  const rawBody = await readRawBody(req);
  const ok = verifySlack(
    rawBody,
    req.headers["x-slack-signature"] as string | undefined,
    req.headers["x-slack-request-timestamp"] as string | undefined,
    signingSecret
  );
  if (!ok) {
    res.status(401).json({ error: "Invalid Slack signature" });
    return;
  }

  // Body is `payload=<url-encoded JSON>`.
  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    res.status(400).json({ error: "Missing payload" });
    return;
  }
  let payload: {
    type?: string;
    message?: { text?: string; ts?: string; permalink?: string };
    channel?: { id?: string; name?: string };
    user?: { username?: string };
    team?: { domain?: string };
  };
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    res.status(400).json({ error: "Bad payload JSON" });
    return;
  }

  if (payload.type !== "message_action") {
    // Slack also probes with other interaction types — ack them so the app stays healthy.
    res.status(200).json({});
    return;
  }

  const text = (payload.message?.text ?? "").trim();
  if (!text) {
    res.status(200).json({ response_type: "ephemeral", text: "Nothing to capture — the message had no text." });
    return;
  }

  // Idempotency: the same message captured twice (double-click) inserts once.
  // Keyed on team+channel+message-ts, which is stable for a given Slack message.
  const idemSource = `slack:${payload.team?.domain ?? ""}:${payload.channel?.id ?? ""}:${payload.message?.ts ?? ""}`;
  const idempotencyKey = createHash("sha256").update(idemSource).digest("hex");

  const supabase = createClient(supabaseUrl, serviceKey);
  const content = text.substring(0, 10000);
  const metadata: Record<string, unknown> = {};
  if (payload.channel?.name) metadata.channel = payload.channel.name;
  if (payload.user?.username) metadata.from = payload.user.username;
  if (payload.message?.permalink) metadata.permalink = payload.message.permalink;

  try {
    const { error } = await supabase.from("capture_queue").insert({
      user_id: userId,
      status: "pending",
      source: "slack",
      raw_content: content,
      raw_metadata: metadata,
      idempotency_key: idempotencyKey,
    });
    if (error && error.code !== "23505") {
      // 23505 = the idempotency unique index: already captured. Treat as success.
      console.error("Slack capture insert error:", error.message);
      res.status(500).json({ error: "Failed to capture" });
      return;
    }
  } catch (err) {
    console.error("Slack capture unexpected error:", err);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  // Slack shows this confirmation to the user who triggered the action.
  const preview = content.length > 80 ? content.slice(0, 77) + "…" : content;
  res.status(200).json({
    response_type: "ephemeral",
    text: `✓ Captured to FocusBoard: "${preview}"`,
  });
}
