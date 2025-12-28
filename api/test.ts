import { createClient } from "@supabase/supabase-js";

export default function handler(req: any, res: any) {
  try {
    res.status(200).json({ ok: true, hasCreateClient: typeof createClient === "function" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
