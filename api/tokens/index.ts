import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { setCorsHeaders, handlePreflight } from "../_lib/cors.js";
import { verifySession } from "../_lib/auth.js";
import { generateToken, SCOPES } from "../_lib/token.js";

const ALLOWED_SCOPES = new Set<string>([SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE]);

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

  const user = await verifySession(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    return handleList(user.id, res);
  }

  if (req.method === "POST") {
    return handleCreate(user.id, req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function handleList(userId: string, res: VercelResponse) {
  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("api_tokens")
      .select("id, name, scopes, last_used_at, created_at, revoked_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Token list error:", error.message);
      return res.status(500).json({ error: "Failed to list tokens" });
    }

    return res.status(200).json({ tokens: data ?? [] });
  } catch (err) {
    console.error("Token list unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function handleCreate(userId: string, req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body as { name?: unknown; scopes?: unknown } | undefined;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: "name must be 100 characters or fewer" });
    }

    // Determine scopes — default to capture:read + capture:write if not supplied
    let scopes: string[];
    if (body?.scopes !== undefined) {
      if (!Array.isArray(body.scopes)) {
        return res.status(400).json({ error: "scopes must be an array" });
      }
      const requested = body.scopes as unknown[];
      for (const s of requested) {
        if (typeof s !== "string" || !ALLOWED_SCOPES.has(s)) {
          return res.status(400).json({
            error: `Invalid scope "${String(s)}". Allowed: capture:read, capture:write`,
          });
        }
      }
      scopes = requested as string[];
    } else {
      scopes = [SCOPES.CAPTURE_READ, SCOPES.CAPTURE_WRITE];
    }

    const { plaintext, hash } = generateToken();

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("api_tokens")
      .insert({
        user_id: userId,
        name,
        token_hash: hash,
        scopes,
      })
      .select("id, name")
      .single();

    if (error) {
      console.error("Token create error:", error.message);
      return res.status(500).json({ error: "Failed to create token" });
    }

    return res.status(201).json({
      token: plaintext,
      id: data.id as string,
      name: data.name as string,
    });
  } catch (err) {
    console.error("Token create unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
