import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import type { AppState } from "../../src/app/types.js";
import type { ParsedCaptureCard } from "../../src/app/captureTypes.js";

const CONFIDENCE_THRESHOLD = 0.8;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { capture_id, user_id, internal_secret, auto_add = true } = req.body || {};

    // Authenticate: only callable by internal trigger with shared secret
    const expectedSecret = process.env.CAPTURE_INTERNAL_SECRET;
    if (!expectedSecret || typeof internal_secret !== "string" ||
        internal_secret.length !== expectedSecret.length ||
        !timingSafeEqual(Buffer.from(internal_secret), Buffer.from(expectedSecret))) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!capture_id || !user_id) {
      return res.status(400).json({ error: "capture_id and user_id required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Mark as processing — guarded so we never resurrect a capture the user
    // already dismissed/triaged in the gap since insert.
    await supabase
      .from("capture_queue")
      .update({ status: "processing" })
      .eq("id", capture_id)
      .eq("status", "pending");

    // Fetch the capture item
    const { data: capture, error: fetchError } = await supabase
      .from("capture_queue")
      .select("*")
      .eq("id", capture_id)
      .single();

    if (fetchError || !capture) {
      return res.status(404).json({ error: "Capture item not found" });
    }

    // Verify the capture belongs to the claimed user
    if (capture.user_id !== user_id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Fetch board context for AI
    const { data: stateData } = await supabase
      .from("app_state")
      .select("state")
      .eq("user_id", user_id)
      .single();

    const appState: AppState | null = stateData?.state ?? null;

    // Build context strings
    const existingTitles = appState?.cards
      ?.filter((c) => !c.archivedAt)
      .map((c) => c.title)
      .slice(0, 50) // Limit for token budget
      .join("\n") ?? "No existing cards";

    const existingTags = appState?.tags
      ?.map((t) => `${t.id} (${t.name})`)
      .join(", ") ?? "high (High), medium (Medium), low (Low), bug (Bug), feature (Feature), chore (Chore)";

    const columnList = appState?.columns
      ?.map((c) => `${c.id} (${c.title})`)
      .join(", ") ?? "backlog, design, todo, doing, blocked, done";

    const today = new Date().toISOString().split("T")[0];

    // Source-specific context
    const sourceContext = capture.raw_metadata
      ? `Source metadata: ${JSON.stringify(capture.raw_metadata)}`
      : "";

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a task extraction assistant for a Kanban board app called FocusBoard.

Parse the following raw captured content into one or more structured task cards.

RAW CONTENT (from ${capture.source}):
"""
${capture.raw_content}
"""
${sourceContext}

BOARD CONTEXT:
- Available columns: ${columnList}
- Available tags: ${existingTags}
- Today's date: ${today}
- Existing card titles (for duplicate detection):
${existingTitles}

EXTRACTION RULES:
1. Extract one or more distinct tasks from the content
2. For each task, provide:
   - title: Clean, actionable task title (imperative form, max 80 chars)
   - notes: Brief context summary if useful (max 200 chars)
   - tags: Array of tag IDs from the available tags
   - swimlane: "work" or "personal" (default "work")
   - suggestedColumn: Column ID (default "backlog", use "todo" for urgent/clear tasks)
   - dueDate: ISO date if mentioned or implied (relative to today: ${today})
   - confidence: 0.0-1.0 how confident you are in this extraction
   - duplicateOf: If it closely matches an existing card title, put that title here. Otherwise null.
   - relatedTo: Array of existing card titles that seem related. Otherwise empty array.
3. A single email thread might contain multiple tasks — extract each one
4. Confidence scoring:
   - 0.9+: Clear, unambiguous single task
   - 0.7-0.9: Reasonable extraction but some ambiguity
   - Below 0.7: Vague content, unclear action items

Return ONLY valid JSON array. No markdown, no explanation.
Example: [{"title":"Review Q3 budget","notes":"From finance team email","tags":["high"],"swimlane":"work","suggestedColumn":"todo","dueDate":"2026-02-14","confidence":0.92,"duplicateOf":null,"relatedTo":[]}]`
      }]
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";

    let parsedCards;
    try {
      const cleaned = text.trim().replace(/```json\n?|\n?```/g, "");
      parsedCards = JSON.parse(cleaned);
      if (!Array.isArray(parsedCards)) {
        parsedCards = [parsedCards];
      }
    } catch {
      // Fallback: create a basic card from the raw content
      const title = capture.raw_content.substring(0, 80).trim();
      parsedCards = [{
        title: title || "Captured item",
        confidence: 0.3,
        tags: [],
        swimlane: "work",
        suggestedColumn: "backlog",
        duplicateOf: null,
        relatedTo: [],
      }];
    }

    // Calculate overall confidence (average)
    const avgConfidence = parsedCards.reduce((sum: number, c: { confidence?: number }) => sum + (c.confidence ?? 0.5), 0) / parsedCards.length;

    // Determine status based on confidence.
    // PAT/external captures (auto_add === false) must never become auto_added — they
    // always land in the inbox as "ready" so the user reviews them.
    const status = (avgConfidence >= CONFIDENCE_THRESHOLD && auto_add !== false) ? "auto_added" : "ready";

    // Update capture_queue with results. The STATUS write is guarded to rows
    // still in the pipeline ("pending"/"processing") — the user may dismiss or
    // triage the capture while the AI is parsing, and an unconditional write
    // resurrects it into the inbox (caught live by the authed deploy smoke:
    // capture → dismiss → the item came back as "ready").
    const { data: statusRow } = await supabase
      .from("capture_queue")
      .update({
        status,
        confidence: avgConfidence,
        parsed_cards: parsedCards,
        processed_at: new Date().toISOString(),
      })
      .eq("id", capture_id)
      .in("status", ["pending", "processing"])
      .select("id")
      .maybeSingle();

    const statusApplied = Boolean(statusRow);
    if (!statusApplied) {
      // Status changed underneath us — keep the user's status, still persist
      // the parse results for if/when the capture is revisited.
      await supabase
        .from("capture_queue")
        .update({
          confidence: avgConfidence,
          parsed_cards: parsedCards,
          processed_at: new Date().toISOString(),
        })
        .eq("id", capture_id);
    }

    // If high confidence, auto-add cards to board — but never for PAT/external
    // captures, and never when the status write lost the race above (the user
    // already dealt with the capture; adding cards now would contradict them).
    if (statusApplied && status === "auto_added" && appState && auto_add !== false) {
      // Phase 4a: cards are added through the atomic fb_add_card function
      // (app_state row locked inside the tx, mirror synced by trigger) — the
      // old read-modify-write blob upsert here could clobber concurrent web
      // saves. Auto-added cards now land at the BOTTOM of their column
      // (max order + 1) instead of shifting everything down.
      const { nanoid } = await import("nanoid");
      const now = new Date().toISOString();

      const maxOrder = (column: string, swimlane: string) =>
        appState.cards
          .filter((c) => c.column === column && (c.swimlane ?? "work") === swimlane)
          .reduce((max, c) => Math.max(max, c.order ?? 0), 0);

      for (const parsed of parsedCards as ParsedCaptureCard[]) {
        const column = parsed.suggestedColumn || "backlog";
        const swimlane = parsed.swimlane || "work";
        const card = {
          id: nanoid(),
          column,
          swimlane,
          title: parsed.title,
          order: maxOrder(column, swimlane) + 1,
          notes: parsed.notes || `Captured from ${capture.source}`,
          tags: parsed.tags || [],
          dueDate: parsed.dueDate || undefined,
          checklist: [],
          createdAt: now,
          updatedAt: now,
          columnHistory: [{ from: null, to: column, at: now }],
        };
        const { error: addError } = await supabase.rpc("fb_add_card", {
          p_user: user_id,
          p_card: card,
        });
        if (addError) console.error("Auto-add card error:", addError.message);
      }
    }

    return res.status(200).json({
      success: true,
      status,
      confidence: avgConfidence,
      cardCount: parsedCards.length,
    });
  } catch (err) {
    console.error("Capture process error:", err);

    // Recover: update the stuck item to "ready" with a fallback card so it doesn't spin forever
    try {
      const { capture_id } = req.body || {};
      if (capture_id) {
        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: stuck } = await supabase
          .from("capture_queue")
          .select("raw_content, status")
          .eq("id", capture_id)
          .single();

        if (stuck && (stuck.status === "pending" || stuck.status === "processing")) {
          const title = (stuck.raw_content || "Captured item").substring(0, 80).trim();
          await supabase
            .from("capture_queue")
            .update({
              status: "ready",
              confidence: 0,
              parsed_cards: [{
                title,
                confidence: 0,
                tags: [],
                swimlane: "work",
                suggestedColumn: "backlog",
                duplicateOf: null,
                relatedTo: [],
                notes: "AI processing failed — review and edit this card",
              }],
              processed_at: new Date().toISOString(),
            })
            .eq("id", capture_id)
            // Same race guard as the success path: the read above is stale by
            // the time we write — never resurrect a dismissed/triaged capture.
            .in("status", ["pending", "processing"]);
        }
      }
    } catch (recoveryErr) {
      console.error("Capture recovery also failed:", recoveryErr);
    }

    return res.status(500).json({ error: "Processing failed" });
  }
}
