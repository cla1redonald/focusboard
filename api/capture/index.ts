import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { resolveApiToken, hasScope, SCOPES } from "../_lib/token.js";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { content, source = "in_app", metadata = {}, secret } = req.body || {};

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    let userId: string | null = null;
    let isPat = false;

    // Auth priority: PAT > webhook secret > session token
    const patResolved = await resolveApiToken(req);

    if (patResolved) {
      // PAT path
      if (!hasScope(patResolved, SCOPES.CAPTURE_WRITE)) {
        return res.status(403).json({ error: "Insufficient scope" });
      }
      userId = patResolved.userId;
      isPat = true;
    } else if (secret) {
      // Webhook secret path (external channels)
      const expectedSecret = process.env.WEBHOOK_SECRET;
      if (!expectedSecret || typeof secret !== "string" || secret.length !== expectedSecret.length ||
          !timingSafeEqual(Buffer.from(secret), Buffer.from(expectedSecret))) {
        return res.status(401).json({ error: "Invalid secret" });
      }
      userId = process.env.FOCUSBOARD_USER_ID ?? null;
    } else {
      // Session-based auth for in-app capture
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace("Bearer ", "");
      if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const authClient = createClient(supabaseUrl, supabaseKey);
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

    const supabase = createClient(supabaseUrl, supabaseKey);

    // PAT-specific guards: rate limit and idempotency
    if (isPat) {
      // Rate limit: max 30 captures per 60 seconds per user
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();
      const { count } = await supabase
        .from("capture_queue")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", windowStart);

      if ((count ?? 0) > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: "Rate limit exceeded" });
      }

      // Idempotency: if header is present, check for an existing row
      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from("capture_queue")
          .select("id")
          .eq("user_id", userId)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existing) {
          return res.status(200).json({
            success: true,
            message: "Duplicate capture — returning existing",
            captureId: existing.id,
          });
        }
      }
    }

    // Validate source — PAT captures use "in_app" since there's no cli/mcp enum value yet
    const validSources = ['email', 'slack', 'shortcut', 'browser', 'whatsapp', 'in_app'];
    const safeSource = validSources.includes(source) ? source : 'in_app';

    // Build the insert payload
    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      status: "pending",
      source: safeSource,
      raw_content: content.trim().substring(0, 10000),
      raw_metadata: (() => {
        const serialized = JSON.stringify(metadata ?? {});
        if (serialized.length > 5120) return {};
        return metadata ?? {};
      })(),
    };

    // Attach idempotency key if provided on PAT requests
    if (isPat) {
      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      if (idempotencyKey) {
        insertPayload.idempotency_key = idempotencyKey;
      }
    }

    const { data, error: insertError } = await supabase
      .from("capture_queue")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertError) {
      // Postgres unique constraint violation — another request raced us with the same idempotency key
      if (insertError.code === "23505") {
        const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
        if (idempotencyKey) {
          const { data: raced } = await supabase
            .from("capture_queue")
            .select("id")
            .eq("user_id", userId)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          return res.status(200).json({
            success: true,
            message: "Duplicate capture — returning existing",
            captureId: raced?.id ?? null,
          });
        }
      }

      console.error("Capture insert error:", insertError.message);
      return res.status(500).json({ error: "Failed to save capture" });
    }

    // Trigger async processing — waitUntil keeps the function alive after response.
    // PAT/external captures pass auto_add: false to prevent high-confidence items
    // from being auto-added to the board; they always land in the inbox.
    const processUrl = `https://${req.headers.host}/api/capture/process`;
    const internalSecret = process.env.CAPTURE_INTERNAL_SECRET;
    waitUntil(
      fetch(processUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capture_id: data.id,
          user_id: userId,
          internal_secret: internalSecret,
          auto_add: isPat ? false : true,
        }),
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
