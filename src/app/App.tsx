import React, { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useAppState } from "./state";
import type { AppState, Card, Column, ColumnId, MetricsState, RelationType, SwimlaneId } from "./types";
import { loadMetrics, saveMetrics, recordCompletedCard, takeDailySnapshot } from "./metrics";
import { hasSeenOnboarding, markOnboardingSeen } from "./storage";
import { AuthProvider, useRequireAuth, useAuth } from "./AuthContext";
import { ToastProvider, useToast } from "./ToastContext";
import { isSupabaseConfigured } from "./supabase";
import { cleanupCardAttachments } from "./attachmentCleanup";
import { debouncedSaveMetricsToSupabase } from "./sync";
import { useCaptureQueue } from "./useCaptureQueue";
import type { ParsedCaptureCard } from "./captureTypes";
import { Board } from "../components/Board";
import { CardModal } from "../components/CardModal";
import { SettingsPanel } from "../components/SettingsPanel";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";
import { CommandPalette } from "../components/CommandPalette";
import { OnboardingModal } from "../components/OnboardingModal";
import { ToastContainer } from "../components/ToastContainer";
import { LoginPage } from "../components/LoginPage";
import { SetPasswordPage } from "../components/SetPasswordPage";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FeedbackModal } from "../components/FeedbackModal";

// Lazy load heavy panel components to reduce initial bundle size
const MetricsDashboard = React.lazy(() => import("../components/MetricsDashboard").then(m => ({ default: m.MetricsDashboard })));
const TimelinePanel = React.lazy(() => import("../components/TimelinePanel").then(m => ({ default: m.TimelinePanel })));
const FocusSuggestionPanel = React.lazy(() => import("../components/FocusSuggestionPanel").then(m => ({ default: m.FocusSuggestionPanel })));
const WeeklyPlanPanel = React.lazy(() => import("../components/WeeklyPlanPanel").then(m => ({ default: m.WeeklyPlanPanel })));
const ArchivePanel = React.lazy(() => import("../components/ArchivePanel").then(m => ({ default: m.ArchivePanel })));
const CaptureInbox = React.lazy(() => import("../components/CaptureInbox").then(m => ({ default: m.CaptureInbox })));

// Loading fallback for lazy-loaded panels
function PanelLoadingFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <span className="text-gray-600 dark:text-gray-300">Loading...</span>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, signOut } = useAuth();
  // Pass userId to useAppState to fix race condition - ensures storage is user-scoped
  const { state, dispatch, canUndo, canRedo } = useAppState(user?.id);
  const { showToast } = useToast();
  const [openCard, setOpenCard] = React.useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [metricsDashboardOpen, setMetricsDashboardOpen] = React.useState(false);
  const [timelinePanelOpen, setTimelinePanelOpen] = React.useState(false);
  const [focusPanelOpen, setFocusPanelOpen] = React.useState(false);
  const [weeklyPlanOpen, setWeeklyPlanOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [archivePanelOpen, setArchivePanelOpen] = React.useState(false);
  const [captureInboxOpen, setCaptureInboxOpen] = React.useState(false);
  const [onboardingOpen, setOnboardingOpen] = React.useState(() => !hasSeenOnboarding());
  const [metrics, setMetrics] = React.useState<MetricsState>(() => loadMetrics());
  const { reviewItems, processingItems, autoAddedItems, pendingCount, dismissItem, deleteItem } = useCaptureQueue(user?.id ?? null);
  const hasBgImage = !!state.settings.backgroundImage;

  // Ref for accessing current state in stable callbacks without creating deps
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // --- Stable callbacks (never change identity) ---
  const handleOpenCard = React.useCallback((c: Card) => setOpenCard(c), []);
  const handleSettings = React.useCallback(() => setSettingsOpen(true), []);
  const handleOpenMetrics = React.useCallback(() => setMetricsDashboardOpen(true), []);
  const handleOpenTimeline = React.useCallback(() => setTimelinePanelOpen(true), []);
  const handleOpenFocus = React.useCallback(() => setFocusPanelOpen(true), []);
  const handleOpenWeeklyPlan = React.useCallback(() => setWeeklyPlanOpen(true), []);
  const handleOpenFeedback = React.useCallback(() => setFeedbackOpen(true), []);
  const handleShowTutorial = React.useCallback(() => setOnboardingOpen(true), []);
  const handleShowShortcuts = React.useCallback(() => setShortcutsOpen(true), []);
  const handleOpenArchive = React.useCallback(() => setArchivePanelOpen(true), []);
  const handleOpenCapture = React.useCallback(() => setCaptureInboxOpen(true), []);
  const handleUndo = React.useCallback(() => dispatch({ type: "UNDO" }), [dispatch]);
  const handleRedo = React.useCallback(() => dispatch({ type: "REDO" }), [dispatch]);

  const handleAdd = React.useCallback(
    (column: ColumnId, title: string, swimlane?: SwimlaneId) => {
      dispatch({ type: "ADD_CARD", column, title, swimlane });
      showToast({ type: "success", message: `Card "${title}" added` });
    },
    [dispatch, showToast]
  );

  const handleAddWithData = React.useCallback(
    (column: ColumnId, title: string, swimlane: SwimlaneId, data: { tags?: string[]; dueDate?: string; notes?: string }) => {
      dispatch({ type: "ADD_CARD_WITH_DATA", column, title, swimlane, data });
      showToast({ type: "success", message: `Card "${title}" added with AI` });
    },
    [dispatch, showToast]
  );

  const handleAddCaptureCard = React.useCallback(
    (parsedCard: ParsedCaptureCard, captureId: string) => {
      dispatch({
        type: "ADD_CARD_WITH_DATA",
        column: parsedCard.suggestedColumn || "backlog",
        title: parsedCard.title,
        swimlane: parsedCard.swimlane || "work",
        data: {
          tags: parsedCard.tags,
          dueDate: parsedCard.dueDate,
          notes: parsedCard.notes,
        },
      });
      showToast({ type: "success", message: `Added "${parsedCard.title}" from capture` });
      void dismissItem(captureId);
    },
    [dispatch, showToast, dismissItem]
  );

  const handleMove = React.useCallback(
    (id: string, to: ColumnId, toSwimlane?: SwimlaneId, patch?: Partial<Card>) => {
      const card = stateRef.current.cards.find((c) => c.id === id);
      const toColumn = stateRef.current.columns.find((c) => c.id === to);
      dispatch({ type: "MOVE_CARD", id, to, toSwimlane, patch });
      // Toast context is split — showToast only triggers ToastContainer re-render,
      // not AppContent, so it's safe to call synchronously (React 18 batches it)
      if (card && toColumn) {
        showToast({
          type: "info",
          message: `Moved "${card.title}" to ${toColumn.title}`,
          undoAction: () => dispatch({ type: "UNDO" }),
        });
      }
    },
    [dispatch, showToast]
  );

  const handleDelete = React.useCallback(
    (id: string) => {
      const card = stateRef.current.cards.find((c) => c.id === id);
      dispatch({ type: "DELETE_CARD", id });
      if (card) {
        showToast({
          type: "warning",
          message: `Deleted "${card.title}"`,
          undoAction: () => dispatch({ type: "UNDO" }),
        });
      }
    },
    [dispatch, showToast]
  );

  const handleReorderCards = React.useCallback(
    (columnId: ColumnId, cardIds: string[], swimlane?: SwimlaneId) => {
      dispatch({ type: "REORDER_CARDS", columnId, cardIds, swimlane });
    },
    [dispatch]
  );

  const handleToggleSwimlaneCollapse = React.useCallback(
    (swimlaneId: SwimlaneId) => {
      dispatch({ type: "TOGGLE_SWIMLANE_COLLAPSE", swimlaneId });
    },
    [dispatch]
  );
  // Memoized calculations for FocusSuggestionPanel
  const completedToday = React.useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return metrics.completedCards.filter((c) => c.completedAt.startsWith(today)).length;
  }, [metrics.completedCards]);

  const avgCycleTime = React.useMemo(() => {
    if (!metrics.completedCards.length) return undefined;
    const total = metrics.completedCards.reduce((sum, c) => sum + (c.cycleTimeMs || 0), 0);
    return total / metrics.completedCards.length;
  }, [metrics.completedCards]);

  // Memoized calculation for WeeklyPlanPanel
  const avgThroughput = React.useMemo(() => {
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const recentCards = metrics.completedCards.filter(
      (c) => new Date(c.completedAt) >= fourWeeksAgo
    );
    return recentCards.length > 0 ? Math.ceil(recentCards.length / 4) : 5;
  }, [metrics.completedCards]);

  // Memoized check for whether openCard is completed
  const isOpenCardCompleted = React.useMemo(() => {
    const card = openCard ? state.cards.find((c) => c.id === openCard.id) : null;
    const col = card ? state.columns.find((c) => c.id === card.column) : null;
    return col?.isTerminal ?? false;
  }, [openCard, state.cards, state.columns]);

  // Compute active (non-archived) cards for the board
  const activeCards = React.useMemo(
    () => state.cards.filter((c) => !c.archivedAt),
    [state.cards]
  );

  // Compute archived cards once, reuse for count and ArchivePanel
  const archivedCards = React.useMemo(
    () => state.cards.filter((c) => !!c.archivedAt),
    [state.cards]
  );

  // Keyboard shortcuts for ? to show help and Cmd+K for command palette
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K for command palette (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Cmd+Shift+C for capture inbox (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
        e.preventDefault();
        setCaptureInboxOpen(true);
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Track previously completed cards to detect new completions
  const prevCardsRef = React.useRef<Card[]>([]);

  // Take daily snapshot on mount
  React.useEffect(() => {
    const updated = takeDailySnapshot(activeCards, state.columns, metrics);
    if (updated !== metrics) {
      setMetrics(updated);
      saveMetrics(updated);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track when cards move to terminal columns (completed)
  React.useEffect(() => {
    const terminalColumnIds = new Set(
      state.columns.filter((c) => c.isTerminal).map((c) => c.id)
    );

    const prevCards = prevCardsRef.current;
    const prevCardMap = new Map(prevCards.map((c) => [c.id, c]));
    let updatedMetrics = metrics;

    for (const card of state.cards) {
      if (terminalColumnIds.has(card.column)) {
        const prevCard = prevCardMap.get(card.id);
        // If card just moved to terminal column
        if (prevCard && !terminalColumnIds.has(prevCard.column)) {
          updatedMetrics = recordCompletedCard(card, state.columns, updatedMetrics);
        }
      }
    }

    if (updatedMetrics !== metrics) {
      setMetrics(updatedMetrics);
      // Defer localStorage write so it doesn't block drag animations
      requestAnimationFrame(() => saveMetrics(updatedMetrics));
    }

    prevCardsRef.current = state.cards;
  }, [state.cards, state.columns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Note: Supabase sync for state is handled in useAppState (state.ts)
  // with echo suppression. Only metrics need syncing here.
  React.useEffect(() => {
    if (isSupabaseConfigured()) {
      debouncedSaveMetricsToSupabase(metrics);
    }
  }, [metrics]);

  // Apply auto-priorities when enabled
  React.useEffect(() => {
    if (!state.settings.autoPriorityFromDueDate) return;

    // Apply immediately on mount/setting change
    dispatch({ type: "APPLY_AUTO_PRIORITIES" });

    // Also run every hour to catch urgency changes
    const interval = setInterval(() => {
      dispatch({ type: "APPLY_AUTO_PRIORITIES" });
    }, 60 * 60 * 1000); // 1 hour

    return () => clearInterval(interval);
  }, [state.settings.autoPriorityFromDueDate, dispatch]);

  // Auto-archive completed cards from previous months (single effect: compute, dispatch, toast)
  const autoArchiveToastShown = React.useRef(false);
  React.useEffect(() => {
    if (autoArchiveToastShown.current) return;
    if (!state.settings.autoArchive) return;

    // Count cards that would be auto-archived before dispatch
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const terminalColumnIds = new Set(
      state.columns.filter((c) => c.isTerminal).map((c) => c.id)
    );

    const eligibleCount = state.cards.filter((card) => {
      if (card.archivedAt) return false;
      if (!terminalColumnIds.has(card.column)) return false;
      if (!card.completedAt) return false;
      const d = new Date(card.completedAt);
      return d.getFullYear() < currentYear ||
        (d.getFullYear() === currentYear && d.getMonth() < currentMonth);
    }).length;

    autoArchiveToastShown.current = true;
    dispatch({ type: "AUTO_ARCHIVE_CARDS" });

    if (eligibleCount > 0) {
      showToast({
        type: "info",
        message: `Auto-archived ${eligibleCount} completed card${eligibleCount !== 1 ? "s" : ""} from previous months`,
        undoAction: () => dispatch({ type: "UNDO" }),
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-bg">
      {hasBgImage && (
        <div
          className="bg-photo"
          style={{ backgroundImage: `url(${state.settings.backgroundImage})` }}
        />
      )}
      <div className="bg-scrim" />
      {!hasBgImage && <div className="orb orb-1" />}
      {!hasBgImage && <div className="orb orb-2" />}
      {!hasBgImage && <div className="orb orb-3" />}
      <div className="noise" />

      <div className="app-shell h-full px-3 py-4 sm:px-6 sm:py-8">
        <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col">
          <Board
            cards={activeCards}
            columns={state.columns}
            settings={state.settings}
            metrics={metrics}
            tagDefinitions={state.tags}
            archivedCount={archivedCards.length}
            onOpenArchive={handleOpenArchive}
            onOpenCapture={handleOpenCapture}
            captureCount={pendingCount}
            onAdd={handleAdd}
            onAddWithData={handleAddWithData}
            onMove={handleMove}
            onDelete={handleDelete}
            onOpenCard={handleOpenCard}
            onSettings={handleSettings}
            onOpenMetrics={handleOpenMetrics}
            onOpenTimeline={handleOpenTimeline}
            onOpenFocus={handleOpenFocus}
            onOpenWeeklyPlan={handleOpenWeeklyPlan}
            onOpenFeedback={handleOpenFeedback}
            onShowTutorial={handleShowTutorial}
            onShowShortcuts={handleShowShortcuts}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onReorderCards={handleReorderCards}
            onToggleSwimlaneCollapse={handleToggleSwimlaneCollapse}
          />
        </div>
      </div>

      <CardModal
        open={!!openCard}
        card={openCard ? state.cards.find((c) => c.id === openCard.id) ?? openCard : null}
        allCards={activeCards}
        tags={state.tags}
        tagCategories={state.tagCategories}
        userId={user?.id}
        onClose={() => setOpenCard(null)}
        onSave={(card) => {
          dispatch({ type: "UPDATE_CARD", card });
          setOpenCard(null);
        }}
        onDelete={(id) => {
          const card = state.cards.find((c) => c.id === id);
          // Cleanup attachments from Supabase Storage
          if (card?.attachments?.length) {
            void cleanupCardAttachments(card.attachments);
          }
          dispatch({ type: "DELETE_CARD", id });
          setOpenCard(null);
        }}
        onMarkComplete={(id) => {
          const card = state.cards.find((c) => c.id === id);
          const doneColumn = state.columns.find((c) => c.isTerminal);
          if (card && doneColumn) {
            dispatch({ type: "MOVE_CARD", id, to: doneColumn.id, toSwimlane: card.swimlane });
            setOpenCard(null);
            showToast({ type: "success", message: `"${card.title}" marked complete!` });
          }
        }}
        isCompleted={isOpenCardCompleted}
        onArchive={(id) => {
          const card = state.cards.find((c) => c.id === id);
          dispatch({ type: "ARCHIVE_CARD", id });
          setOpenCard(null);
          if (card) {
            showToast({
              type: "info",
              message: `Archived "${card.title}"`,
              undoAction: () => dispatch({ type: "UNDO" }),
            });
          }
        }}
        onAddRelation={(cardId: string, targetCardId: string, relationType: RelationType) => {
          dispatch({ type: "ADD_RELATION", cardId, targetCardId, relationType });
        }}
        onRemoveRelation={(cardId: string, relationId: string) => {
          dispatch({ type: "REMOVE_RELATION", cardId, relationId });
        }}
        onAddTag={(tag) => dispatch({ type: "ADD_TAG", tag })}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={state.settings}
        columns={state.columns}
        state={state}
        onClose={() => setSettingsOpen(false)}
        onChange={(settings) => dispatch({ type: "SET_SETTINGS", settings })}
        onUpdateColumn={(column: Column) => dispatch({ type: "UPDATE_COLUMN", column })}
        onAddColumn={(column: Omit<Column, "id" | "order">) => dispatch({ type: "ADD_COLUMN", column })}
        onDeleteColumn={(id: string, migrateCardsTo?: string) => dispatch({ type: "DELETE_COLUMN", id, migrateCardsTo })}
        onReorderColumns={(columns: Column[]) => dispatch({ type: "REORDER_COLUMNS", columns })}
        onImport={(newState: AppState) => dispatch({ type: "IMPORT_STATE", state: newState })}
        onSignOut={signOut}
        onAddTag={(tag) => dispatch({ type: "ADD_TAG", tag })}
        onUpdateTag={(tag) => dispatch({ type: "UPDATE_TAG", tag })}
        onDeleteTag={(id) => dispatch({ type: "DELETE_TAG", id })}
        onAddTagCategory={(category) => dispatch({ type: "ADD_TAG_CATEGORY", category })}
        onUpdateTagCategory={(category) => dispatch({ type: "UPDATE_TAG_CATEGORY", category })}
        onDeleteTagCategory={(id) => dispatch({ type: "DELETE_TAG_CATEGORY", id })}
      />

      {/* Lazy-loaded panels wrapped in Suspense and ErrorBoundary */}
      {metricsDashboardOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <MetricsDashboard
              open={metricsDashboardOpen}
              metrics={metrics}
              cards={activeCards}
              columns={state.columns}
              settings={state.settings}
              onClose={() => setMetricsDashboardOpen(false)}
              onOpenCard={(card) => {
                setMetricsDashboardOpen(false);
                setOpenCard(card);
              }}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {timelinePanelOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <TimelinePanel
              open={timelinePanelOpen}
              cards={activeCards}
              columns={state.columns}
              onClose={() => setTimelinePanelOpen(false)}
              onOpenCard={(card) => {
                setTimelinePanelOpen(false);
                setOpenCard(card);
              }}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {focusPanelOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <FocusSuggestionPanel
              open={focusPanelOpen}
              cards={activeCards}
              columns={state.columns}
              onClose={() => setFocusPanelOpen(false)}
              onStartTask={(cardId) => {
                const card = state.cards.find((c) => c.id === cardId);
                const doingColumn = state.columns.find((c) => c.id === "doing");
                if (card && doingColumn) {
                  dispatch({ type: "MOVE_CARD", id: cardId, to: doingColumn.id, toSwimlane: card.swimlane });
                  showToast({ type: "success", message: `Started "${card.title}"` });
                }
              }}
              completedToday={completedToday}
              avgCycleTime={avgCycleTime}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {weeklyPlanOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <WeeklyPlanPanel
              open={weeklyPlanOpen}
              cards={activeCards}
              columns={state.columns}
              onClose={() => setWeeklyPlanOpen(false)}
              onSetDueDate={(cardId, dueDate) => {
                const card = state.cards.find((c) => c.id === cardId);
                if (card) {
                  dispatch({
                    type: "UPDATE_CARD",
                    card: { ...card, dueDate, updatedAt: new Date().toISOString() },
                  });
                  showToast({ type: "success", message: `Set "${card.title}" due ${dueDate}` });
                }
              }}
              avgThroughput={avgThroughput}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {archivePanelOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <ArchivePanel
              open={archivePanelOpen}
              archivedCards={archivedCards}
              columns={state.columns}
              tags={state.tags}
              onClose={() => setArchivePanelOpen(false)}
              onUnarchive={(id: string, toColumn: ColumnId) => {
                const card = state.cards.find((c) => c.id === id);
                dispatch({ type: "UNARCHIVE_CARD", id, toColumn });
                if (card) {
                  const col = state.columns.find((c) => c.id === toColumn);
                  showToast({
                    type: "success",
                    message: `Restored "${card.title}" to ${col?.title ?? "column"}`,
                    undoAction: () => dispatch({ type: "UNDO" }),
                  });
                }
              }}
              onOpenCard={(card) => {
                setArchivePanelOpen(false);
                setOpenCard(card);
              }}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {captureInboxOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <CaptureInbox
              open={captureInboxOpen}
              reviewItems={reviewItems}
              processingItems={processingItems}
              autoAddedItems={autoAddedItems}
              columns={state.columns}
              tags={state.tags}
              onClose={() => setCaptureInboxOpen(false)}
              onAddCard={handleAddCaptureCard}
              onDismiss={dismissItem}
              onDelete={deleteItem}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        cards={activeCards}
        columns={state.columns}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenCard={(card) => {
          setCommandPaletteOpen(false);
          setOpenCard(card);
        }}
        onOpenSettings={() => {
          setCommandPaletteOpen(false);
          setSettingsOpen(true);
        }}
        onOpenMetrics={() => {
          setCommandPaletteOpen(false);
          setMetricsDashboardOpen(true);
        }}
        onOpenTimeline={() => {
          setCommandPaletteOpen(false);
          setTimelinePanelOpen(true);
        }}
        onOpenArchive={() => {
          setCommandPaletteOpen(false);
          setArchivePanelOpen(true);
        }}
        onOpenCapture={() => {
          setCommandPaletteOpen(false);
          setCaptureInboxOpen(true);
        }}
        onJumpToColumn={(columnId) => {
          const columnEl = document.querySelector(`[data-column-id="${columnId}"]`);
          if (columnEl) {
            columnEl.scrollIntoView({ behavior: "smooth", inline: "center" });
          }
        }}
      />

      <OnboardingModal
        open={onboardingOpen}
        onClose={() => {
          setOnboardingOpen(false);
          markOnboardingSeen();
        }}
      />

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSuccess={() => showToast({ type: "success", message: "Thanks for your feedback!" })}
      />

      <ToastContainer />
    </div>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useRequireAuth();
  const [isRecoveryFlow, setIsRecoveryFlow] = React.useState(false);

  // Check for password recovery flow (Supabase adds #type=recovery to URL)
  React.useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecoveryFlow(true);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Show password set page during recovery flow
  if (isRecoveryFlow && isAuthenticated) {
    return <SetPasswordPage onComplete={() => setIsRecoveryFlow(false)} />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AuthenticatedApp />
        <Analytics />
        <SpeedInsights />
      </AuthProvider>
    </ErrorBoundary>
  );
}
