import { getSupabaseAdmin } from "./_lib/supabase";

export default function handler(req: any, res: any) {
  try {
    const supabase = getSupabaseAdmin();
    res.status(200).json({ ok: true, hasSupabase: !!supabase });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
