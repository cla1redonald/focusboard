import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { verifySession } from "../_lib/auth.js";

// Inline types (minimal for the endpoint)
type Card = {
  id: string;
  column: string;
  title: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  notes?: string;
  columnHistory?: Array<{ from: string | null; to: string; at: string }>;
  swimlane?: "work" | "personal";
};

type AppState = {
  cards: Card[];
  columns: Array<{ id: string; title: string; icon: string; color: string; wipLimit: number | null; isTerminal: boolean; order: number }>;
  templates: unknown[];
  settings: Record<string, unknown>;
  tagCategories: Array<{ id: string; name: string; order: number }>;
  tags: Array<{ id: string; name: string; color: string; categoryId: string }>;
};

// Feedback tag definitions
const FEEDBACK_CATEGORY = { id: "feedback", name: "Feedback", order: 4 };
const FEEDBACK_TAGS = {
  bug: { id: "feedback-bug", name: "Bug Report", color: "#EF4444", categoryId: "feedback" },
  feature: { id: "feedback-feature", name: "Feature Request", color: "#8B5CF6", categoryId: "feedback" },
};

function createFeedbackCard(
  title: string,
  description: string,
  type: "bug" | "feature",
  submitterEmail: string
): Card {
  const now = new Date().toISOString();
  const tagId = type === "bug" ? FEEDBACK_TAGS.bug.id : FEEDBACK_TAGS.feature.id;
  
  let notes = "";
  if (description) {
    notes += description + "\n\n";
  }
  notes += `---\nSubmitted by: ${submitterEmail}\nSubmitted at: ${new Date().toLocaleString()}`;

  return {
    id: nanoid(),
    column: "backlog",
    title: title.trim(),
    order: 0,
    createdAt: now,
    updatedAt: now,
    tags: [tagId],
    notes,
    columnHistory: [{ from: null, to: "backlog", at: now }],
    swimlane: "work",
  };
}

function ensureFeedbackTagsExist(state: AppState): AppState {
  let updated = { ...state };
  
  // Ensure feedback category exists
  if (!updated.tagCategories.some((c) => c.id === FEEDBACK_CATEGORY.id)) {
    updated = {
      ...updated,
      tagCategories: [...updated.tagCategories, FEEDBACK_CATEGORY],
    };
  }

  // Ensure feedback tags exist
  for (const tag of Object.values(FEEDBACK_TAGS)) {
    if (!updated.tags.some((t) => t.id === tag.id)) {
      updated = {
        ...updated,
        tags: [...updated.tags, tag],
      };
    }
  }

  return updated;
}

function getDefaultState(): AppState {
  return {
    cards: [],
    columns: [
      { id: "backlog", title: "Backlog", icon: "archive", color: "#64748b", wipLimit: null, isTerminal: false, order: 0 },
      { id: "design", title: "Design & Planning", icon: "palette", color: "#8b5cf6", wipLimit: 5, isTerminal: false, order: 1 },
      { id: "todo", title: "To Do", icon: "list-todo", color: "#0d9488", wipLimit: 12, isTerminal: false, order: 2 },
      { id: "doing", title: "Doing", icon: "zap", color: "#f59e0b", wipLimit: 3, isTerminal: false, order: 3 },
      { id: "blocked", title: "Blocked", icon: "ban", color: "#ef4444", wipLimit: 5, isTerminal: false, order: 4 },
      { id: "done", title: "Done", icon: "check-circle", color: "#10b981", wipLimit: null, isTerminal: true, order: 5 },
    ],
    templates: [],
    settings: { celebrations: true, reducedMotionOverride: false, backgroundImage: null, showAgingIndicators: true, staleCardThreshold: 7 },
    tagCategories: [
      { id: "goals", name: "Goals", order: 0 },
      { id: "priority", name: "Priority", order: 1 },
      { id: "type", name: "Type", order: 2 },
      { id: "effort", name: "Effort", order: 3 },
      { id: "feedback", name: "Feedback", order: 4 },
      { id: "custom", name: "Custom", order: 5 },
    ],
    tags: [
      { id: "high", name: "High", color: "#EF4444", categoryId: "priority" },
      { id: "medium", name: "Medium", color: "#F59E0B", categoryId: "priority" },
      { id: "low", name: "Low", color: "#10B981", categoryId: "priority" },
      { id: "feedback-bug", name: "Bug Report", color: "#EF4444", categoryId: "feedback" },
      { id: "feedback-feature", name: "Feature Request", color: "#8B5CF6", categoryId: "feedback" },
    ],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Verify user is authenticated
    const user = await verifySession(req);
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { type, title, description } = req.body || {};

    // Validate type
    if (!type || !["bug", "feature"].includes(type)) {
      return res.status(400).json({ error: "Invalid type. Must be 'bug' or 'feature'" });
    }

    // Validate title
    if (!title?.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Get owner user ID from environment
    const ownerUserId = process.env.FEEDBACK_OWNER_USER_ID;
    if (!ownerUserId) {
      return res.status(500).json({ error: "FEEDBACK_OWNER_USER_ID not configured" });
    }

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: "Supabase not configured" });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch owner's current state
    const { data, error: fetchError } = await supabase
      .from("app_state")
      .select("state")
      .eq("user_id", ownerUserId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Feedback fetch error:", fetchError.message, fetchError.code);
      return res.status(500).json({ error: `Failed to fetch state: ${fetchError.message}` });
    }

    let state: AppState = data?.state ?? getDefaultState();

    // Ensure feedback tags exist in owner's state
    state = ensureFeedbackTagsExist(state);

    // Create feedback card
    const card = createFeedbackCard(
      title.trim(),
      description?.trim() || "",
      type,
      user.email || "Anonymous"
    );

    // Shift cards in backlog to make room at top
    state.cards = state.cards.map((c) =>
      c.column === "backlog" && (c.swimlane ?? "work") === "work"
        ? { ...c, order: c.order + 1 }
        : c
    );
    state.cards.unshift(card);

    // Save updated state
    const { error: upsertError } = await supabase.from("app_state").upsert(
      {
        user_id: ownerUserId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (upsertError) {
      console.error("Feedback upsert error:", upsertError.message, upsertError.code);
      return res.status(500).json({ error: `Failed to save feedback: ${upsertError.message}` });
    }

    return res.status(200).json({
      success: true,
      message: "Thank you for your feedback!",
    });
  } catch (err) {
    console.error("Feedback unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

