import { nanoid } from "nanoid";
import type { SupabaseClient } from "@supabase/supabase-js";

// Inline types to avoid importing from src/ (which breaks Vercel functions)
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
};

type AppState = {
  cards: Card[];
  columns: Array<{ id: string; title: string; icon: string; color: string; wipLimit: number | null; isTerminal: boolean; order: number }>;
  templates: unknown[];
  settings: { celebrations: boolean; reducedMotionOverride: boolean; backgroundImage: string | null; showAgingIndicators: boolean; staleCardThreshold: number };
  tagCategories: Array<{ id: string; name: string; order: number }>;
  tags: Array<{ id: string; name: string; color: string; categoryId: string }>;
};

export function createCard(title: string, column = "backlog", source?: string): Card {
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
  };
}

function getDefaultState(): AppState {
  return {
    cards: [],
    columns: [
      { id: "backlog", title: "Backlog", icon: "📋", color: "#86B6B0", wipLimit: null, isTerminal: false, order: 0 },
      { id: "design", title: "Design & Planning", icon: "✨", color: "#9EC6AD", wipLimit: 5, isTerminal: false, order: 1 },
      { id: "todo", title: "To Do", icon: "📝", color: "#B6D6C1", wipLimit: 12, isTerminal: false, order: 2 },
      { id: "doing", title: "Doing", icon: "🎯", color: "#7ABFA6", wipLimit: 1, isTerminal: false, order: 3 },
      { id: "blocked", title: "Blocked", icon: "🚧", color: "#A6C2C7", wipLimit: 5, isTerminal: false, order: 4 },
      { id: "done", title: "Done", icon: "✅", color: "#6FBAC8", wipLimit: null, isTerminal: true, order: 5 },
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

export async function addCardToUserState(
  supabase: SupabaseClient,
  userId: string,
  card: Card
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch current state
    const { data, error: fetchError } = await supabase
      .from("app_state")
      .select("state")
      .eq("user_id", userId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 = no rows found, which is fine for new users
      return { success: false, error: fetchError.message };
    }

    const state: AppState = data?.state ?? getDefaultState();

    // Shift existing cards in the same column down (increase order)
    state.cards = state.cards.map((c) =>
      c.column === card.column ? { ...c, order: c.order + 1 } : c
    );

    // Add new card at top (order 0)
    state.cards.unshift(card);

    // Save back
    const { error: upsertError } = await supabase.from("app_state").upsert({
      user_id: userId,
      state,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      return { success: false, error: upsertError.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
