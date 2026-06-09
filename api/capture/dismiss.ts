import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { resolveApiToken, hasScope, SCOPES } from "../_lib/token.js";

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

    const { captureId } = req.body || {};

    if (!captureId || typeof captureId !== "string") {
      return res.status(400).json({ error: "captureId is required" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("capture_queue")
      .update({ status: "dismissed" })
      .eq("id", captureId)
      .eq("user_id", resolved.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Dismiss update error:", error.message);
      return res.status(500).json({ error: "Failed to dismiss capture" });
    }

    if (!data) {
      return res.status(404).json({ error: "Capture not found" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Dismiss unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
