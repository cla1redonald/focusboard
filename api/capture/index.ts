import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content, source = "in_app", metadata = {}, secret, user_id } = req.body || {};

    // Auth: either webhook secret (external channels) or session auth
    const expectedSecret = process.env.WEBHOOK_SECRET;

    // For external channels: validate secret + require user_id
    // For in-app: validate session token
    let userId: string | null = null;

    if (secret) {
      if (!expectedSecret || typeof secret !== "string" || secret.length !== expectedSecret.length ||
          !timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret))) {
        return res.status(401).json({ error: "Invalid secret" });
      }
      // Always use server-side user ID for webhook — never trust client-supplied user_id
      userId = process.env.FOCUSBOARD_USER_ID ?? null;
    } else {
      // Session-based auth for in-app capture
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const supabaseUrl = process.env.SUPABASE_URL!;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const authClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error } = await authClient.auth.getUser(token);
      if (error || !user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      userId = user.id;
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    if (!content?.trim()) {
      return res.status(400).json({ error: "Content is required" });
    }

    // Validate source
    const validSources = ['email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app'];
    const safeSource = validSources.includes(source) ? source : 'in_app';

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert into capture_queue
    const { data, error: insertError } = await supabase
      .from("capture_queue")
      .insert({
        user_id: userId,
        status: "pending",
        source: safeSource,
        raw_content: content.trim().substring(0, 10000), // Limit content size
        raw_metadata: (() => {
          const serialized = JSON.stringify(metadata ?? {});
          if (serialized.length > 5120) return {}; // 5KB limit
          return metadata ?? {};
        })(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Capture insert error:", insertError.message);
      return res.status(500).json({ error: "Failed to save capture" });
    }

    // Trigger async processing — waitUntil keeps the function alive after response
    const processUrl = `https://${req.headers.host}/api/capture/process`;
    const internalSecret = process.env.CAPTURE_INTERNAL_SECRET;
    waitUntil(
      fetch(processUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capture_id: data.id, user_id: userId, internal_secret: internalSecret }),
      }).catch((err) => console.error("Process trigger failed:", err))
    );

    return res.status(200).json({
      success: true,
      message: `Captured from ${safeSource}`,
      captureId: data.id,
    });
  } catch (err) {
    console.error("Capture unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
