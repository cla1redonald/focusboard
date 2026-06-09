import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { resolveApiToken, hasScope, SCOPES } from "../_lib/token.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const resolved = await resolveApiToken(req);
    if (!resolved) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!hasScope(resolved, SCOPES.CAPTURE_READ)) {
      return res.status(403).json({ error: "Insufficient scope" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Return pending captures visible right now:
    // status = 'pending' AND (snoozed_until IS NULL OR snoozed_until <= now)
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("capture_queue")
      .select(
        "id, raw_content, source, status, created_at, snoozed_until, confidence, parsed_cards, processed_at"
      )
      .eq("user_id", resolved.userId)
      .eq("status", "pending")
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Inbox fetch error:", error.message);
      return res.status(500).json({ error: "Failed to fetch inbox" });
    }

    return res.status(200).json({
      items: data ?? [],
      total: (data ?? []).length,
    });
  } catch (err) {
    console.error("Inbox unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
