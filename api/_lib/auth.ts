import { createClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

/**
 * Verify Supabase session from Authorization header
 * Returns the authenticated user or null if invalid/missing
 */
export async function verifySession(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return null;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Supabase credentials not configured");
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Session verification error:", error);
    return null;
  }
}
