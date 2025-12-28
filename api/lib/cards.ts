import { nanoid } from "nanoid";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Card, AppState, Column, TagCategory, Tag } from "../../src/app/types";
import { DEFAULT_COLUMNS, DEFAULT_SETTINGS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "../../src/app/constants";

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
    columns: DEFAULT_COLUMNS,
    templates: [],
    settings: DEFAULT_SETTINGS,
    tagCategories: DEFAULT_TAG_CATEGORIES,
    tags: DEFAULT_TAGS,
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
