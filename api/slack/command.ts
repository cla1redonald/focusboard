import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackRequest } from "../_lib/slack";
import { getSupabaseAdmin } from "../_lib/supabase";
import { createCard, addCardToUserState } from "../_lib/cards";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get raw body for signature verification
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : new URLSearchParams(req.body).toString();

  // Verify Slack signature
  const signature = req.headers["x-slack-signature"] as string;
  const timestamp = req.headers["x-slack-request-timestamp"] as string;

  if (!signature || !timestamp) {
    return res.status(401).json({ error: "Missing Slack headers" });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  if (!verifySlackRequest(signingSecret, signature, timestamp, rawBody)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Parse the command
  const text = req.body.text?.trim();

  if (!text) {
    return res.json({
      response_type: "ephemeral",
      text: "Usage: `/backlog <card title>`\n\nExample: `/backlog Review Q1 metrics`",
    });
  }

  // Get user ID from environment (single-user setup)
  const userId = process.env.FOCUSBOARD_USER_ID;
  if (!userId) {
    console.error("FOCUSBOARD_USER_ID not configured");
    return res.json({
      response_type: "ephemeral",
      text: "Server configuration error. Please check FOCUSBOARD_USER_ID.",
    });
  }

  // Create and add the card
  const card = createCard(text, "backlog", "Slack");
  const result = await addCardToUserState(getSupabaseAdmin(), userId, card);

  if (!result.success) {
    console.error("Failed to add card:", result.error);
    return res.json({
      response_type: "ephemeral",
      text: `Failed to add card: ${result.error}`,
    });
  }

  return res.json({
    response_type: "ephemeral",
    text: `Added to backlog: *${text}*`,
  });
}
