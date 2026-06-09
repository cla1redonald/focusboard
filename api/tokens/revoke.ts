import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { verifySession } from "../_lib/auth.js";

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase credentials not configured");
  }
  return createClient(supabaseUrl, serviceKey);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await verifySession(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body as { id?: unknown } | undefined;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Token revoke error:", error.message);
      return res.status(500).json({ error: "Failed to revoke token" });
    }

    if (!data) {
      return res.status(404).json({ error: "Token not found" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Token revoke unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
