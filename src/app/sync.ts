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
// Must pass userId to filter subscription to only this user's changes
export function subscribeToStateChanges(
  userId: string,
  onStateChange: (state: AppState) => void
): (() => void) | null {
  if (!supabase) return null;

  const client = supabase; // Capture for closure
  const channel = client
    .channel(`app_state_changes:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "app_state",
        filter: `user_id=eq.${userId}`, // Only receive updates for this user
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
    void client.removeChannel(channel);
  };
}

// Debounced save to avoid too many writes
// Separate timeouts for state and metrics to prevent interference
let stateTimeout: ReturnType<typeof setTimeout> | null = null;
let metricsTimeout: ReturnType<typeof setTimeout> | null = null;
let queuedState: AppState | null = null;
let queuedMetrics: MetricsState | null = null;
const SAVE_DEBOUNCE_MS = 1000;

export function debouncedSaveToSupabase(state: AppState): void {
  queuedState = state;
  if (stateTimeout) {
    clearTimeout(stateTimeout);
  }
  stateTimeout = setTimeout(() => {
    if (queuedState) {
      void saveStateToSupabase(queuedState);
      queuedState = null;
    }
    stateTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}

export function debouncedSaveMetricsToSupabase(metrics: MetricsState): void {
  queuedMetrics = metrics;
  if (metricsTimeout) {
    clearTimeout(metricsTimeout);
  }
  metricsTimeout = setTimeout(() => {
    if (queuedMetrics) {
      void saveMetricsToSupabase(queuedMetrics);
      queuedMetrics = null;
    }
    metricsTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}

export function flushSaveToSupabase(): void {
  if (stateTimeout) {
    clearTimeout(stateTimeout);
    stateTimeout = null;
  }
  if (queuedState) {
    void saveStateToSupabase(queuedState);
    queuedState = null;
  }
}

export function flushSaveMetricsToSupabase(): void {
  if (metricsTimeout) {
    clearTimeout(metricsTimeout);
    metricsTimeout = null;
  }
  if (queuedMetrics) {
    void saveMetricsToSupabase(queuedMetrics);
    queuedMetrics = null;
  }
}
