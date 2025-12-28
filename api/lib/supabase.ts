import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    _supabaseAdmin = createClient(url, key);
  }
  return _supabaseAdmin;
}

// Keep backward compat export
export const supabaseAdmin = {
  from: (table: string) => getSupabaseAdmin().from(table),
};
