import React from "react";
import { supabase } from "./supabase";
import { TRIAGE_STATUSES, type CaptureQueueItem, type CaptureStatus } from "./captureTypes";

const STALE_THRESHOLD_MS = 30_000; // 30 seconds

export function isCaptureVisible(item: Pick<CaptureQueueItem, "snoozed_until">, nowMs: number): boolean {
  if (!item.snoozed_until) return true;
  const snoozedUntilMs = new Date(item.snoozed_until).getTime();
  if (Number.isNaN(snoozedUntilMs)) return true;
  return snoozedUntilMs <= nowMs;
}

export function useCaptureQueue(userId: string | null) {
  const [items, setItems] = React.useState<CaptureQueueItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [snoozeNow, setSnoozeNow] = React.useState(0);

  React.useEffect(() => {
    setSnoozeNow(Date.now());
  }, [userId]);

  React.useEffect(() => {
    const interval = window.setInterval(() => setSnoozeNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Fetch items with status 'ready' or 'auto_added' (last 24h for auto_added)
  const fetchItems = React.useCallback(async () => {
    if (!supabase || !userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("capture_queue")
        .select("*")
        .eq("user_id", userId)
        // Triage set is shared with the API inbox (captureTypes.ts) — keep in sync
        // by construction. The web additionally shows recent auto_added items.
        .in("status", [...TRIAGE_STATUSES, "auto_added"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setItems(data as CaptureQueueItem[]);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Real-time subscription
  React.useEffect(() => {
    if (!supabase || !userId) return;

    // Initial fetch
    void fetchItems();

    // Subscribe to changes
    const channel = supabase
      .channel(`capture_queue:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // INSERT, UPDATE, DELETE
          schema: "public",
          table: "capture_queue",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refetch on any change
          void fetchItems();
        }
      )
      .subscribe();

    return () => {
      if (supabase) void supabase.removeChannel(channel);
    };
  }, [userId, fetchItems]);

  // Unstick items stuck in pending/processing for too long
  React.useEffect(() => {
    const stuck = items.filter(
      (i) =>
        (i.status === "pending" || i.status === "processing") &&
        Date.now() - new Date(i.created_at).getTime() > STALE_THRESHOLD_MS
    );
    if (stuck.length === 0 || !supabase) return;

    for (const item of stuck) {
      const title = (item.raw_content || "Captured item").substring(0, 80).trim();
      void supabase
        .from("capture_queue")
        .update({
          status: "ready" as CaptureStatus,
          confidence: 0,
          parsed_cards: [{
            title,
            confidence: 0,
            tags: [],
            swimlane: "work",
            suggestedColumn: "backlog",
            duplicateOf: null,
            relatedTo: [],
            notes: "AI processing timed out — review and edit this card",
          }],
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .then(() => fetchItems());
    }
  }, [items, fetchItems]);

  // Dismiss an item
  const dismissItem = React.useCallback(async (captureId: string) => {
    if (!supabase) return;
    await supabase
      .from("capture_queue")
      .update({ status: "dismissed" as CaptureStatus })
      .eq("id", captureId);
    setItems((prev) => prev.filter((i) => i.id !== captureId));
  }, []);

  const snoozeItem = React.useCallback(async (captureId: string, minutes: number) => {
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    setItems((prev) => prev.map((item) =>
      item.id === captureId ? { ...item, snoozed_until: until } : item
    ));
    if (!supabase) return;
    const { error } = await supabase
      .from("capture_queue")
      .update({ snoozed_until: until })
      .eq("id", captureId);
    if (error) {
      void fetchItems();
    }
  }, [fetchItems]);

  // Delete an item
  const deleteItem = React.useCallback(async (captureId: string) => {
    if (!supabase) return;
    await supabase
      .from("capture_queue")
      .delete()
      .eq("id", captureId);
    setItems((prev) => prev.filter((i) => i.id !== captureId));
  }, []);

  const visibleItems = React.useMemo(() => {
    return items.filter((item) => isCaptureVisible(item, snoozeNow));
  }, [items, snoozeNow]);

  // Count of items needing attention (ready status)
  const pendingCount = React.useMemo(
    () => visibleItems.filter((i) => i.status === "ready" || i.status === "pending" || i.status === "processing").length,
    [visibleItems]
  );

  // Split items by section
  const reviewItems = React.useMemo(
    () => visibleItems.filter((i) => i.status === "ready"),
    [visibleItems]
  );

  const processingItems = React.useMemo(
    () => visibleItems.filter((i) => i.status === "pending" || i.status === "processing"),
    [visibleItems]
  );

  const autoAddedItems = React.useMemo(
    () => visibleItems.filter((i) => i.status === "auto_added"),
    [visibleItems]
  );

  return {
    items,
    reviewItems,
    processingItems,
    autoAddedItems,
    pendingCount,
    loading,
    fetchItems,
    dismissItem,
    snoozeItem,
    deleteItem,
  };
}
