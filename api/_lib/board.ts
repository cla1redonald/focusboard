import { createClient } from "@supabase/supabase-js";
import type { AppState, Card, Column, Tag } from "../../src/app/types.js";

/**
 * Read-only board access for the API (Phase 2, re-pointed in Phase 4b).
 *
 * Non-card board state (columns, settings, tags, daily plan) lives in the
 * app_state JSONB row; CARDS live in the cards table (one row per card with an
 * optimistic-lock version) — the blob's cards array is retired. This module
 * loads both with the service-role key and projects cards into a SLIM shape
 * for CLI/MCP output. All semantics (what's "active", Today ranking, search
 * matching) are IMPORTED from src/app — never reimplemented — so the API
 * cannot drift from the web app (the inbox status-filter lesson, applied by
 * construction).
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
  /** Per-card optimistic-lock versions from the cards table. */
  versions: Map<string, number>;
};

export async function loadBoard(userId: string): Promise<BoardData | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase credentials not configured");
  const supabase = createClient(url, key);

  const [blobRes, cardsRes] = await Promise.all([
    supabase.from("app_state").select("state").eq("user_id", userId).maybeSingle(),
    supabase.from("cards").select("id, card_json, version").eq("user_id", userId),
  ]);

  if (blobRes.error) {
    console.error("Board load error:", blobRes.error.message);
    throw new Error("Failed to load board");
  }
  if (cardsRes.error) {
    console.error("Cards load error:", cardsRes.error.message);
    throw new Error("Failed to load board");
  }
  // A board = an app_state row (it holds the columns/settings the projections
  // need). No blob row → the user has never opened the web app.
  if (!blobRes.data?.state) return null;

  const rows = cardsRes.data ?? [];
  const cards = rows.map((r) => r.card_json as Card);
  const versions = new Map(rows.map((r) => [r.id as string, Number(r.version)]));

  // The blob may still carry a stale legacy cards array until the cleanup
  // migration strips it — rows win unconditionally.
  const state = { ...(blobRes.data.state as AppState), cards };
  return {
    state,
    cards,
    columns: state.columns ?? [],
    versions,
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
