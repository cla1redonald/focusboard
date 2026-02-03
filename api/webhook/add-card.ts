import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { AppState, Card, ColumnId, SwimlaneId } from "../../src/app/types";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_CATEGORIES,
  DEFAULT_TAGS,
} from "../../src/app/defaults";
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

    // Fetch current state
    const { data, error: fetchError } = await supabase
      .from("app_state")
      .select("state")
      .eq("user_id", userId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Webhook fetch error:", fetchError.message);
      return res.status(500).json({ error: "Failed to fetch state" });
    }

    const state: AppState = data?.state ?? getDefaultState();

    // Create and add card
    const card = createCard(title.trim(), column, source, swimlane);
    // Shift cards in the same column AND swimlane to make room at top (matches main app behavior)
    state.cards = state.cards.map((c) =>
      c.column === card.column && (c.swimlane ?? "work") === card.swimlane
        ? { ...c, order: c.order + 1 }
        : c
    );
    state.cards.unshift(card);

    // Save
    const { error: upsertError } = await supabase.from("app_state").upsert(
      {
        user_id: userId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (upsertError) {
      console.error("Webhook upsert error:", upsertError.message);
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
