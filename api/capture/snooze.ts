import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { resolveApiToken, hasScope, SCOPES } from "../_lib/token.js";

const MIN_MINUTES = 1;
const MAX_MINUTES = 43200; // 30 days

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const resolved = await resolveApiToken(req);
    if (!resolved) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!hasScope(resolved, SCOPES.CAPTURE_WRITE)) {
      return res.status(403).json({ error: "Insufficient scope" });
    }

    const { captureId, minutes: rawMinutes = 60 } = req.body || {};

    if (!captureId || typeof captureId !== "string") {
      return res.status(400).json({ error: "captureId is required" });
    }

    // Clamp minutes to valid range
    const minutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Number(rawMinutes) || 60));
    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("capture_queue")
      .update({ snoozed_until: snoozedUntil })
      .eq("id", captureId)
      .eq("user_id", resolved.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Snooze update error:", error.message);
      return res.status(500).json({ error: "Failed to snooze capture" });
    }

    if (!data) {
      return res.status(404).json({ error: "Capture not found" });
    }

    return res.status(200).json({ ok: true, snoozedUntil });
  } catch (err) {
    console.error("Snooze unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
