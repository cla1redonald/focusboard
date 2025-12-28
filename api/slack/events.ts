import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackRequest } from "../lib/slack";
import { supabaseAdmin } from "../lib/supabase";
import { createCard, addCardToUserState } from "../lib/cards";

type SlackEvent = {
  type: string;
  event?: {
    type: string;
    reaction: string;
    user: string;
    item: {
      type: string;
      channel: string;
      ts: string;
    };
  };
  challenge?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as SlackEvent;

  // Handle Slack URL verification challenge
  if (body.type === "url_verification") {
    return res.json({ challenge: body.challenge });
  }

  // Verify Slack signature
  const signature = req.headers["x-slack-signature"] as string;
  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const rawBody = JSON.stringify(body);

  if (!signature || !timestamp) {
    return res.status(401).json({ error: "Missing Slack headers" });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    return res.status(500).end();
  }

  if (!verifySlackRequest(signingSecret, signature, timestamp, rawBody)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = body.event;

  // Only handle reaction_added events with clipboard emoji
  if (!event || event.type !== "reaction_added") {
    return res.status(200).end();
  }

  // Check for clipboard emoji (📋)
  if (event.reaction !== "clipboard") {
    return res.status(200).end();
  }

  // Only handle message reactions
  if (event.item.type !== "message") {
    return res.status(200).end();
  }

  // Get user ID from environment (single-user setup)
  const userId = process.env.FOCUSBOARD_USER_ID;
  if (!userId) {
    console.error("FOCUSBOARD_USER_ID not configured");
    return res.status(200).end();
  }

  // Fetch the message content from Slack
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.error("SLACK_BOT_TOKEN not configured");
    return res.status(200).end();
  }

  try {
    const msgRes = await fetch(
      `https://slack.com/api/conversations.history?channel=${event.item.channel}&latest=${event.item.ts}&limit=1&inclusive=true`,
      {
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const msgData = await msgRes.json();

    if (!msgData.ok) {
      console.error("Failed to fetch message:", msgData.error);
      return res.status(200).end();
    }

    const messageText = msgData.messages?.[0]?.text;
    if (!messageText) {
      console.error("No message text found");
      return res.status(200).end();
    }

    // Clean up Slack formatting (remove user mentions, channel links, etc.)
    const cleanText = messageText
      .replace(/<@[A-Z0-9]+>/g, "") // Remove user mentions
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1") // Convert channel links
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2") // Convert links
      .replace(/<(https?:\/\/[^>]+)>/g, "$1") // Convert plain links
      .trim();

    if (!cleanText) {
      return res.status(200).end();
    }

    // Create and add the card
    const card = createCard(cleanText, "backlog", "Slack");
    const result = await addCardToUserState(supabaseAdmin, userId, card);

    if (!result.success) {
      console.error("Failed to add card:", result.error);
    }
  } catch (err) {
    console.error("Error processing reaction:", err);
  }

  // Always return 200 to acknowledge the event
  return res.status(200).end();
}
