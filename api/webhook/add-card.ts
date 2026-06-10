import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { AppState, Card, ColumnId, SwimlaneId } from "../../src/app/types.js";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_CATEGORIES,
  DEFAULT_TAGS,
} from "../../src/app/defaults.js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

function createCard(
  title: string,
  column: ColumnId = "backlog",
  source?: string,
  swimlane: SwimlaneId = "work"
): Card {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    column,
    title: title.trim(),
    order: 0,
    createdAt: now,
    updatedAt: now,
    tags: [],
    checklist: [],
    notes: source ? `Added from ${source}` : undefined,
    columnHistory: [{ from: null, to: column, at: now }],
    swimlane,
  };
}

function getDefaultState(): AppState {
  return {
    cards: [],
    columns: DEFAULT_COLUMNS.map((col) => ({ ...col })),
    templates: [],
    settings: { ...DEFAULT_SETTINGS },
    tagCategories: DEFAULT_TAG_CATEGORIES.map((category) => ({ ...category })),
    tags: DEFAULT_TAGS.map((tag) => ({ ...tag })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers - use shared helper instead of wildcard
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, secret, column = "backlog", source = "Webhook", swimlane = "work" } = req.body || {};

    // Validate secret
    const expectedSecret = process.env.WEBHOOK_SECRET;
    if (!expectedSecret) {
      return res.status(500).json({ error: "WEBHOOK_SECRET not configured" });
    }
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: "Invalid secret" });
    }

    // Validate title
    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Get user ID
    const userId = process.env.FOCUSBOARD_USER_ID;
    if (!userId) {
      return res.status(500).json({ error: "FOCUSBOARD_USER_ID not configured" });
    }

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: "Supabase not configured" });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Phase 4a: write through the atomic fb_add_card function instead of a
    // read-modify-write blob upsert (which could clobber concurrent web saves).
    // If the user has no board row yet, seed it with the default state first.
    const { data, error: fetchError } = await supabase
      .from("app_state")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      console.error("Webhook fetch error:", fetchError.message);
      return res.status(500).json({ error: "Failed to fetch state" });
    }
    if (!data) {
      const { error: seedError } = await supabase.from("app_state").upsert(
        { user_id: userId, state: getDefaultState(), updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (seedError) {
        console.error("Webhook seed error:", seedError.message);
        return res.status(500).json({ error: "Failed to save card" });
      }
    }

    const card = createCard(title.trim(), column, source, swimlane);
    const { error: addError } = await supabase.rpc("fb_add_card", {
      p_user: userId,
      p_card: card,
    });

    if (addError) {
      console.error("Webhook add-card error:", addError.message);
      return res.status(500).json({ error: "Failed to save card" });
    }

    return res.status(200).json({
      success: true,
      message: `Added "${title}" to ${column}`,
      cardId: card.id
    });
  } catch (err) {
    console.error("Webhook unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
