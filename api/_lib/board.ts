import { createClient } from "@supabase/supabase-js";
import type { AppState, Card, Column, Tag } from "../../src/app/types.js";

/**
 * Read-only board access for the API (Phase 2).
 *
 * The board lives in one app_state JSONB row per user. This module loads it with
 * the service-role key and projects cards into a SLIM shape for CLI/MCP output.
 * All semantics (what's "active", Today ranking, search matching) are IMPORTED
 * from src/app — never reimplemented — so the API cannot drift from the web app
 * (the inbox status-filter lesson, applied by construction).
 */

export type SlimCard = {
  id: string;
  title: string;
  column: string;
  swimlane: string;
  order: number;
  dueDate?: string;
  tags: string[]; // tag NAMES (resolved), not internal tag ids
  blockedReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type BoardData = {
  state: AppState;
  cards: Card[];
  columns: Column[];
};

export async function loadBoard(userId: string): Promise<BoardData | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("app_state")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Board load error:", error.message);
    throw new Error("Failed to load board");
  }
  if (!data?.state) return null;

  const state = data.state as AppState;
  return {
    state,
    cards: state.cards ?? [],
    columns: state.columns ?? [],
  };
}

export function tagNameResolver(tags: Tag[] | undefined): (ids?: string[]) => string[] {
  const byId = new Map((tags ?? []).map((t) => [t.id, t.name]));
  return (ids) => (ids ?? []).map((id) => byId.get(id) ?? id);
}

export function slimCard(card: Card, resolveTags: (ids?: string[]) => string[]): SlimCard {
  return {
    id: card.id,
    title: card.title,
    column: card.column,
    swimlane: card.swimlane ?? "work",
    order: card.order ?? 0,
    ...(card.dueDate ? { dueDate: card.dueDate } : {}),
    tags: resolveTags(card.tags),
    ...(card.blockedReason ? { blockedReason: card.blockedReason } : {}),
    ...(card.notes ? { notes: card.notes.slice(0, 280) } : {}),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}
