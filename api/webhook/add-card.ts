import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabase";
import { createCard, addCardToUserState } from "../_lib/cards";

/**
 * Simple webhook endpoint for adding cards from Slack Workflow Builder
 * or any other automation tool (Zapier, Make, etc.)
 *
 * POST /api/webhook/add-card
 * Body: { "title": "Card title", "secret": "your-webhook-secret" }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers for preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, secret, column = "backlog", source = "Webhook" } = req.body || {};

    // Simple secret-based auth
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret) {
      console.error("WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Server configuration error" });
    }

    if (secret !== expectedSecret) {
      return res.status(401).json({ error: "Invalid secret" });
    }

    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const userId = process.env.FOCUSBOARD_USER_ID;
    if (!userId) {
      console.error("FOCUSBOARD_USER_ID not configured");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const card = createCard(title.trim(), column, source);
    const supabase = getSupabaseAdmin();
    const result = await addCardToUserState(supabase, userId, card);

    if (!result.success) {
      console.error("Failed to add card:", result.error);
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: `Added "${title}" to ${column}`,
      cardId: card.id
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
