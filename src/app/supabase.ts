import { createClient } from "@supabase/supabase-js";

function getEnvString(key: string): string | undefined {
  const value: unknown = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const supabaseUrl = getEnvString("VITE_SUPABASE_URL");
const supabaseAnonKey = getEnvString("VITE_SUPABASE_ANON_KEY");

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials not configured. Cloud sync disabled.");
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = (): boolean => supabase !== null;
