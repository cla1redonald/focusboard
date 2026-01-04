import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppState, MetricsState } from "./types";

// Sample test data
const mockAppState: AppState = {
  cards: [
    {
      id: "card-1",
      title: "Test Card",
      column: "todo",
      order: 0,
      tags: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  columns: [
    { id: "todo", title: "To Do", order: 0, icon: "inbox", color: "#10b981", wipLimit: null, isTerminal: false },
  ],
  templates: [],
  settings: {
    theme: "system",
    celebrations: true,
    reducedMotionOverride: false,
    backgroundImage: null,
    showAgingIndicators: false,
    staleCardThreshold: 7,
    autoPriorityFromDueDate: false,
    staleBacklogThreshold: 7,
    collapsedSwimlanes: [],
  },
  tagCategories: [],
  tags: [],
};

const mockMetrics: MetricsState = {
  completedCards: [],
  dailySnapshots: [],
  wipViolations: 0,
  currentStreak: 0,
  longestStreak: 0,
};

describe("sync.ts without Supabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("loadStateFromSupabase returns null when supabase is null", async () => {
    vi.doMock("./supabase", () => ({
      supabase: null,
    }));

    const { loadStateFromSupabase } = await import("./sync");
    const result = await loadStateFromSupabase();
    expect(result).toBeNull();
  });

  it("saveStateToSupabase returns false when supabase is null", async () => {
    vi.doMock("./supabase", () => ({
      supabase: null,
    }));

    const { saveStateToSupabase } = await import("./sync");
    const result = await saveStateToSupabase(mockAppState);
    expect(result).toBe(false);
  });

  it("loadMetricsFromSupabase returns null when supabase is null", async () => {
    vi.doMock("./supabase", () => ({
      supabase: null,
    }));

    const { loadMetricsFromSupabase } = await import("./sync");
    const result = await loadMetricsFromSupabase();
    expect(result).toBeNull();
  });

  it("saveMetricsToSupabase returns false when supabase is null", async () => {
    vi.doMock("./supabase", () => ({
      supabase: null,
    }));

    const { saveMetricsToSupabase } = await import("./sync");
    const result = await saveMetricsToSupabase(mockMetrics);
    expect(result).toBe(false);
  });

  it("subscribeToStateChanges returns null when supabase is null", async () => {
    vi.doMock("./supabase", () => ({
      supabase: null,
    }));

    const { subscribeToStateChanges } = await import("./sync");
    const result = subscribeToStateChanges("user-123", vi.fn());
    expect(result).toBeNull();
  });
});

describe("sync.ts with Supabase configured", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loadStateFromSupabase returns null when user is not authenticated", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
        from: vi.fn(),
      },
    }));

    const { loadStateFromSupabase } = await import("./sync");
    const result = await loadStateFromSupabase();
    expect(result).toBeNull();
  });

  it("loadStateFromSupabase returns null when no state exists (PGRST116)", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "PGRST116" },
              }),
            }),
          }),
        }),
      },
    }));

    const { loadStateFromSupabase } = await import("./sync");
    const result = await loadStateFromSupabase();
    expect(result).toBeNull();
  });

  it("loadStateFromSupabase returns state when it exists", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { state: mockAppState },
                error: null,
              }),
            }),
          }),
        }),
      },
    }));

    const { loadStateFromSupabase } = await import("./sync");
    const result = await loadStateFromSupabase();
    expect(result).toEqual(mockAppState);
  });

  it("loadStateFromSupabase logs error on other errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "OTHER_ERROR", message: "Something went wrong" },
              }),
            }),
          }),
        }),
      },
    }));

    const { loadStateFromSupabase } = await import("./sync");
    const result = await loadStateFromSupabase();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load state from Supabase:",
      expect.any(Object)
    );

    consoleSpy.mockRestore();
  });

  it("saveStateToSupabase returns false when user is not authenticated", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
        from: vi.fn(),
      },
    }));

    const { saveStateToSupabase } = await import("./sync");
    const result = await saveStateToSupabase(mockAppState);
    expect(result).toBe(false);
  });

  it("saveStateToSupabase returns true on successful save", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: mockFrom,
      },
    }));

    const { saveStateToSupabase } = await import("./sync");
    const result = await saveStateToSupabase(mockAppState);

    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("app_state");
  });

  it("saveStateToSupabase logs error on failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: { message: "Save failed" } }),
        }),
      },
    }));

    const { saveStateToSupabase } = await import("./sync");
    const result = await saveStateToSupabase(mockAppState);

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to save state to Supabase:",
      expect.any(Object)
    );

    consoleSpy.mockRestore();
  });

  it("loadMetricsFromSupabase returns metrics when they exist", async () => {
    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { metrics: mockMetrics },
                error: null,
              }),
            }),
          }),
        }),
      },
    }));

    const { loadMetricsFromSupabase } = await import("./sync");
    const result = await loadMetricsFromSupabase();
    expect(result).toEqual(mockMetrics);
  });

  it("saveMetricsToSupabase returns true on successful save", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: mockFrom,
      },
    }));

    const { saveMetricsToSupabase } = await import("./sync");
    const result = await saveMetricsToSupabase(mockMetrics);

    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("metrics");
  });

  it("subscribeToStateChanges sets up real-time subscription", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    const mockChannelFn = vi.fn().mockReturnValue(mockChannel);
    const mockRemoveChannel = vi.fn();

    vi.doMock("./supabase", () => ({
      supabase: {
        channel: mockChannelFn,
        removeChannel: mockRemoveChannel,
      },
    }));

    const { subscribeToStateChanges } = await import("./sync");
    const callback = vi.fn();
    const unsubscribe = subscribeToStateChanges("user-123", callback);

    expect(mockChannelFn).toHaveBeenCalledWith("app_state_changes:user-123");
    expect(mockChannel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "app_state",
        filter: "user_id=eq.user-123",
      }),
      expect.any(Function)
    );
    expect(mockChannel.subscribe).toHaveBeenCalled();
    expect(unsubscribe).toBeInstanceOf(Function);
  });

  it("subscribeToStateChanges calls callback on state change", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let changeHandler: any = null;

    const mockChannel = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn((_event: string, _config: unknown, handler: any) => {
        changeHandler = handler;
        return mockChannel;
      }),
      subscribe: vi.fn().mockReturnThis(),
    };

    vi.doMock("./supabase", () => ({
      supabase: {
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn(),
      },
    }));

    const { subscribeToStateChanges } = await import("./sync");
    const callback = vi.fn();
    subscribeToStateChanges("user-123", callback);

    // Simulate state change
    expect(changeHandler).not.toBeNull();
    changeHandler({ new: { state: mockAppState } });

    expect(callback).toHaveBeenCalledWith(mockAppState);
  });

  it("subscribeToStateChanges removes channel on unsubscribe", async () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    const mockRemoveChannel = vi.fn();

    vi.doMock("./supabase", () => ({
      supabase: {
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: mockRemoveChannel,
      },
    }));

    const { subscribeToStateChanges } = await import("./sync");
    const unsubscribe = subscribeToStateChanges("user-123", vi.fn());

    unsubscribe?.();

    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });
});

describe("debounced sync functions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debouncedSaveToSupabase debounces saves", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: mockFrom,
      },
    }));

    const { debouncedSaveToSupabase } = await import("./sync");

    // Call multiple times rapidly
    debouncedSaveToSupabase(mockAppState);
    debouncedSaveToSupabase(mockAppState);
    debouncedSaveToSupabase(mockAppState);

    // Should not have saved yet
    expect(mockFrom).not.toHaveBeenCalled();

    // Advance timer past debounce period
    await vi.advanceTimersByTimeAsync(1000);

    // Should have saved only once
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("debouncedSaveMetricsToSupabase debounces independently", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.doMock("./supabase", () => ({
      supabase: {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
        },
        from: mockFrom,
      },
    }));

    const { debouncedSaveToSupabase, debouncedSaveMetricsToSupabase } = await import("./sync");

    // Call both
    debouncedSaveToSupabase(mockAppState);
    debouncedSaveMetricsToSupabase(mockMetrics);

    // Advance timer
    await vi.advanceTimersByTimeAsync(1000);

    // Both should have saved
    expect(mockFrom).toHaveBeenCalledWith("app_state");
    expect(mockFrom).toHaveBeenCalledWith("metrics");
  });
});
