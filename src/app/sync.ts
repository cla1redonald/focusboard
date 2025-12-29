import { supabase } from "./supabase";
import type { AppState, MetricsState } from "./types";

// Load app state from Supabase
export async function loadStateFromSupabase(): Promise<AppState | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("app_state")
    .select("state")
    .eq("user_id", user.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row found - new user
      return null;
    }
    console.error("Failed to load state from Supabase:", error);
    return null;
  }

  return data?.state as AppState | null;
}

// Save app state to Supabase
export async function saveStateToSupabase(state: AppState): Promise<boolean> {
  if (!supabase) return false;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("app_state")
    .upsert(
      {
        user_id: user.id,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("Failed to save state to Supabase:", error);
    return false;
  }

  return true;
}

// Load metrics from Supabase
export async function loadMetricsFromSupabase(): Promise<MetricsState | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("metrics")
    .select("metrics")
    .eq("user_id", user.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No row found - new user
      return null;
    }
    console.error("Failed to load metrics from Supabase:", error);
    return null;
  }

  return data?.metrics as MetricsState | null;
}

// Save metrics to Supabase
export async function saveMetricsToSupabase(metrics: MetricsState): Promise<boolean> {
  if (!supabase) return false;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("metrics")
    .upsert(
      {
        user_id: user.id,
        metrics,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("Failed to save metrics to Supabase:", error);
    return false;
  }

  return true;
}

// Subscribe to real-time changes (for multi-device sync)
export function subscribeToStateChanges(
  onStateChange: (state: AppState) => void
): (() => void) | null {
  if (!supabase) return null;

  const client = supabase; // Capture for closure
  const channel = client
    .channel("app_state_changes")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "app_state",
      },
      (payload) => {
        const newState = payload.new as { state: AppState };
        if (newState?.state) {
          onStateChange(newState.state);
        }
      }
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

// Debounced save to avoid too many writes
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 1000;

export function debouncedSaveToSupabase(state: AppState): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveStateToSupabase(state);
  }, SAVE_DEBOUNCE_MS);
}

export function debouncedSaveMetricsToSupabase(metrics: MetricsState): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveMetricsToSupabase(metrics);
  }, SAVE_DEBOUNCE_MS);
}
