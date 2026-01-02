import React, { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { useAppState } from "./state";
import type { AppState, Card, Column, MetricsState, RelationType } from "./types";
import { loadMetrics, saveMetrics, recordCompletedCard, takeDailySnapshot } from "./metrics";
import { hasSeenOnboarding, markOnboardingSeen } from "./storage";
import { AuthProvider, useRequireAuth, useAuth } from "./AuthContext";
import { ToastProvider, useToast } from "./ToastContext";
import { isSupabaseConfigured } from "./supabase";
import { cleanupCardAttachments } from "./attachmentCleanup";
import { debouncedSaveToSupabase, debouncedSaveMetricsToSupabase } from "./sync";
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

// Lazy load heavy panel components to reduce initial bundle size
const MetricsDashboard = React.lazy(() => import("../components/MetricsDashboard").then(m => ({ default: m.MetricsDashboard })));
const TimelinePanel = React.lazy(() => import("../components/TimelinePanel").then(m => ({ default: m.TimelinePanel })));
const FocusSuggestionPanel = React.lazy(() => import("../components/FocusSuggestionPanel").then(m => ({ default: m.FocusSuggestionPanel })));
const WeeklyPlanPanel = React.lazy(() => import("../components/WeeklyPlanPanel").then(m => ({ default: m.WeeklyPlanPanel })));

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
  const { state, dispatch, canUndo, canRedo } = useAppState(user?.id ?? null);
  const { showToast } = useToast();
  const [openCard, setOpenCard] = React.useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [metricsDashboardOpen, setMetricsDashboardOpen] = React.useState(false);
  const [timelinePanelOpen, setTimelinePanelOpen] = React.useState(false);
  const [focusPanelOpen, setFocusPanelOpen] = React.useState(false);
  const [weeklyPlanOpen, setWeeklyPlanOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);
  const [onboardingOpen, setOnboardingOpen] = React.useState(() => !hasSeenOnboarding());
  const [metrics, setMetrics] = React.useState<MetricsState>(() => loadMetrics());
  const hasBgImage = !!state.settings.backgroundImage;

  // Keyboard shortcuts for ? to show help and Cmd+K for command palette
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K for command palette (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
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
    const updated = takeDailySnapshot(state.cards, state.columns, metrics);
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
    let updatedMetrics = metrics;

    for (const card of state.cards) {
      if (terminalColumnIds.has(card.column)) {
        const prevCard = prevCards.find((c) => c.id === card.id);
        // If card just moved to terminal column
        if (prevCard && !terminalColumnIds.has(prevCard.column)) {
          updatedMetrics = recordCompletedCard(card, state.columns, updatedMetrics);
        }
      }
    }

    if (updatedMetrics !== metrics) {
      setMetrics(updatedMetrics);
      saveMetrics(updatedMetrics);
    }

    prevCardsRef.current = state.cards;
  }, [state.cards, state.columns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync state to Supabase when it changes
  React.useEffect(() => {
    if (isSupabaseConfigured()) {
      debouncedSaveToSupabase(state);
    }
  }, [state]);

  // Sync metrics to Supabase when they change
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
            cards={state.cards}
            columns={state.columns}
            settings={state.settings}
            metrics={metrics}
            tagDefinitions={state.tags}
            onAdd={(column, title, swimlane) => {
              dispatch({ type: "ADD_CARD", column, title, swimlane });
              showToast({ type: "success", message: `Card "${title}" added` });
            }}
            onAddWithData={(column, title, swimlane, data) => {
              dispatch({ type: "ADD_CARD_WITH_DATA", column, title, swimlane, data });
              showToast({ type: "success", message: `Card "${title}" added with AI` });
            }}
            onMove={(id, to, toSwimlane, patch) => {
              const card = state.cards.find((c) => c.id === id);
              const toColumn = state.columns.find((c) => c.id === to);
              dispatch({ type: "MOVE_CARD", id, to, toSwimlane, patch });
              if (card && toColumn) {
                showToast({
                  type: "info",
                  message: `Moved "${card.title}" to ${toColumn.title}`,
                  undoAction: () => dispatch({ type: "UNDO" }),
                });
              }
            }}
            onDelete={(id) => {
              const card = state.cards.find((c) => c.id === id);
              dispatch({ type: "DELETE_CARD", id });
              if (card) {
                showToast({
                  type: "warning",
                  message: `Deleted "${card.title}"`,
                  undoAction: () => dispatch({ type: "UNDO" }),
                });
              }
            }}
            onOpenCard={(c) => setOpenCard(c)}
            onSettings={() => setSettingsOpen(true)}
            onOpenMetrics={() => setMetricsDashboardOpen(true)}
            onOpenTimeline={() => setTimelinePanelOpen(true)}
            onOpenFocus={() => setFocusPanelOpen(true)}
            onOpenWeeklyPlan={() => setWeeklyPlanOpen(true)}
            onShowTutorial={() => setOnboardingOpen(true)}
            onShowShortcuts={() => setShortcutsOpen(true)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => dispatch({ type: "UNDO" })}
            onRedo={() => dispatch({ type: "REDO" })}
            onReorderCards={(columnId, cardIds, swimlane) => dispatch({ type: "REORDER_CARDS", columnId, cardIds, swimlane })}
            onToggleSwimlaneCollapse={(swimlaneId) => dispatch({ type: "TOGGLE_SWIMLANE_COLLAPSE", swimlaneId })}
          />
        </div>
      </div>

      <CardModal
        open={!!openCard}
        card={openCard ? state.cards.find((c) => c.id === openCard.id) ?? openCard : null}
        allCards={state.cards}
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
            cleanupCardAttachments(card.attachments);
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
        isCompleted={(() => {
          const card = openCard ? state.cards.find((c) => c.id === openCard.id) : null;
          const col = card ? state.columns.find((c) => c.id === card.column) : null;
          return col?.isTerminal ?? false;
        })()}
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
              cards={state.cards}
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
              cards={state.cards}
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
              cards={state.cards}
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
              completedToday={(() => {
                const today = new Date().toISOString().split("T")[0];
                return metrics.completedCards.filter((c) => c.completedAt.startsWith(today)).length;
              })()}
              avgCycleTime={(() => {
                if (!metrics.completedCards.length) return undefined;
                const total = metrics.completedCards.reduce((sum, c) => sum + (c.cycleTimeMs || 0), 0);
                return total / metrics.completedCards.length;
              })()}
            />
          </ErrorBoundary>
        </Suspense>
      )}

      {weeklyPlanOpen && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <ErrorBoundary>
            <WeeklyPlanPanel
              open={weeklyPlanOpen}
              cards={state.cards}
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
              avgThroughput={(() => {
                // Calculate weekly throughput from completed cards in last 4 weeks
                const fourWeeksAgo = new Date();
                fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
                const recentCards = metrics.completedCards.filter(
                  (c) => new Date(c.completedAt) >= fourWeeksAgo
                );
                return recentCards.length > 0 ? Math.ceil(recentCards.length / 4) : 5;
              })()}
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
        cards={state.cards}
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
