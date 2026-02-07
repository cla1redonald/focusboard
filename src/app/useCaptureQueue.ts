import React from "react";
import { supabase } from "./supabase";
import type { CaptureQueueItem, CaptureStatus } from "./captureTypes";

const STALE_THRESHOLD_MS = 30_000; // 30 seconds

export function useCaptureQueue(userId: string | null) {
  const [items, setItems] = React.useState<CaptureQueueItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Fetch items with status 'ready' or 'auto_added' (last 24h for auto_added)
  const fetchItems = React.useCallback(async () => {
    if (!supabase || !userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("capture_queue")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["pending", "processing", "ready", "auto_added"])
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

  // Delete an item
  const deleteItem = React.useCallback(async (captureId: string) => {
    if (!supabase) return;
    await supabase
      .from("capture_queue")
      .delete()
      .eq("id", captureId);
    setItems((prev) => prev.filter((i) => i.id !== captureId));
  }, []);

  // Count of items needing attention (ready status)
  const pendingCount = React.useMemo(
    () => items.filter((i) => i.status === "ready" || i.status === "pending" || i.status === "processing").length,
    [items]
  );

  // Split items by section
  const reviewItems = React.useMemo(
    () => items.filter((i) => i.status === "ready"),
    [items]
  );

  const processingItems = React.useMemo(
    () => items.filter((i) => i.status === "pending" || i.status === "processing"),
    [items]
  );

  const autoAddedItems = React.useMemo(
    () => items.filter((i) => i.status === "auto_added"),
    [items]
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
    deleteItem,
  };
}
