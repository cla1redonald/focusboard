import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

// Inline types
type Card = {
  id: string;
  column: string;
  title: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  checklist?: Array<{ id: string; text: string; done: boolean }>;
  notes?: string;
  columnHistory?: Array<{ from: string | null; to: string; at: string }>;
  swimlane?: "work" | "personal";
};

type AppState = {
  cards: Card[];
  columns: Array<{ id: string; title: string; icon: string; color: string; wipLimit: number | null; isTerminal: boolean; order: number }>;
  templates: unknown[];
  settings: { celebrations: boolean; reducedMotionOverride: boolean; backgroundImage: string | null; showAgingIndicators: boolean; staleCardThreshold: number };
  tagCategories: Array<{ id: string; name: string; order: number }>;
  tags: Array<{ id: string; name: string; color: string; categoryId: string }>;
};

function createCard(title: string, column = "backlog", source?: string, swimlane: "work" | "personal" = "work"): Card {
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
    columns: [
      { id: "backlog", title: "Backlog", icon: "🗂️", color: "#F59E0B", wipLimit: null, isTerminal: false, order: 0 },
      { id: "design", title: "Design & Planning", icon: "🎨", color: "#FBBF24", wipLimit: 5, isTerminal: false, order: 1 },
      { id: "todo", title: "To Do", icon: "📝", color: "#FCD34D", wipLimit: 12, isTerminal: false, order: 2 },
      { id: "doing", title: "Doing", icon: "⚡", color: "#FB923C", wipLimit: 1, isTerminal: false, order: 3 },
      { id: "blocked", title: "Blocked", icon: "⛔", color: "#F87171", wipLimit: 5, isTerminal: false, order: 4 },
      { id: "done", title: "Done", icon: "✅", color: "#34D399", wipLimit: null, isTerminal: true, order: 5 },
    ],
    templates: [],
    settings: { celebrations: true, reducedMotionOverride: false, backgroundImage: null, showAgingIndicators: false, staleCardThreshold: 7 },
    tagCategories: [
      { id: "priority", name: "Priority", order: 0 },
      { id: "type", name: "Type", order: 1 },
      { id: "effort", name: "Effort", order: 2 },
    ],
    tags: [
      { id: "urgent", name: "Urgent", color: "#EF4444", categoryId: "priority" },
      { id: "high", name: "High", color: "#F97316", categoryId: "priority" },
      { id: "medium", name: "Medium", color: "#EAB308", categoryId: "priority" },
      { id: "low", name: "Low", color: "#22C55E", categoryId: "priority" },
    ],
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
    state.cards = state.cards.map((c) =>
      c.column === card.column ? { ...c, order: c.order + 1 } : c
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
