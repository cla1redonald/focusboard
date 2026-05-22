/**
 * Integration tests for the useAppState ↔ Supabase sync wiring.
 *
 * Regression target: the empty-default-state queued at mount used to
 * wipe a populated cloud row after IMPORT_STATE arrived, because the
 * queued save survived the isExternalUpdate guard. These tests pin the
 * fix in place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AppState } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_COLUMNS, DEFAULT_TAG_CATEGORIES, DEFAULT_TAGS } from "./constants";

const cloudCardsState: AppState = {
  cards: [
    {
      id: "cloud-card-1",
      title: "Real cloud card",
      column: "todo",
      order: 0,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-01T00:00:00Z",
    },
  ],
  columns: DEFAULT_COLUMNS,
  templates: [],
  settings: DEFAULT_SETTINGS,
  tagCategories: DEFAULT_TAG_CATEGORIES,
  tags: DEFAULT_TAGS,
};

// Each test creates its own mocks; resetModules between tests so the
// dynamic import of state.ts picks up the latest mock implementations.
describe("useAppState ↔ Supabase sync", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT flush an empty save before cloud load completes", async () => {
    const saveStateCalls: AppState[] = [];

    // Resolve the cloud load on demand so the test controls timing.
    let resolveCloudLoad: (state: AppState | null) => void = () => {};
    const cloudLoadPromise = new Promise<AppState | null>((res) => {
      resolveCloudLoad = res;
    });

    vi.doMock("./supabase", () => ({
      supabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
      isSupabaseConfigured: () => true,
    }));

    vi.doMock("./sync", () => ({
      loadStateFromSupabase: vi.fn(() => cloudLoadPromise),
      saveStateToSupabase: vi.fn(async (state: AppState) => {
        saveStateCalls.push(state);
        return true;
      }),
      // debouncedSaveToSupabase calls saveStateToSupabase synchronously
      // in this test so we can assert call count without dealing with
      // real timers — the actual debounce is covered in sync.test.ts.
      debouncedSaveToSupabase: vi.fn((state: AppState) => {
        saveStateCalls.push(state);
      }),
      flushSaveToSupabase: vi.fn(),
      cancelPendingSaveToSupabase: vi.fn(),
      subscribeToStateChanges: vi.fn(() => null),
      debouncedSaveMetricsToSupabase: vi.fn(),
    }));

    const { useAppState } = await import("./state");

    renderHook(() => useAppState("user-x"));

    // Mount has happened, but cloud load is still pending. The bug would
    // queue saveStateCalls[0] = empty default state here.
    expect(saveStateCalls).toHaveLength(0);

    // Resolve the cloud load with real cards.
    await act(async () => {
      resolveCloudLoad(cloudCardsState);
      // Give React a tick to flush effects.
      await Promise.resolve();
      await Promise.resolve();
    });

    // After cloud load resolves, only the imported (real) state should
    // ever be observed by the sync layer — never the empty default.
    await waitFor(() => {
      expect(saveStateCalls.some((s) => s.cards.length > 0)).toBe(false);
      // No call with empty default cards either: cloud load triggered
      // IMPORT_STATE which set isExternalUpdate=true, so no save is
      // expected at all from the mount + load sequence.
    });

    const emptySaves = saveStateCalls.filter((s) => s.cards.length === 0);
    expect(emptySaves, "no empty-state save should ever be queued").toHaveLength(0);
  });

  it("calls cancelPendingSaveToSupabase when cloud load finishes", async () => {
    const cancelMock = vi.fn();

    vi.doMock("./supabase", () => ({
      supabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
      isSupabaseConfigured: () => true,
    }));

    vi.doMock("./sync", () => ({
      loadStateFromSupabase: vi.fn(async () => null),
      saveStateToSupabase: vi.fn(async () => true),
      debouncedSaveToSupabase: vi.fn(),
      flushSaveToSupabase: vi.fn(),
      cancelPendingSaveToSupabase: cancelMock,
      subscribeToStateChanges: vi.fn(() => null),
      debouncedSaveMetricsToSupabase: vi.fn(),
    }));

    const { useAppState } = await import("./state");

    renderHook(() => useAppState("user-y"));

    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalled();
    });
  });
});
