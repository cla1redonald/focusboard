import React from "react";
import { useAppState } from "./state";
import type { AppState, Card, Column, MetricsState, RelationType } from "./types";
import { loadMetrics, saveMetrics, recordCompletedCard, takeDailySnapshot } from "./metrics";
import { Board } from "../components/Board";
import { CardModal } from "../components/CardModal";
import { SettingsPanel } from "../components/SettingsPanel";
import { MetricsDashboard } from "../components/MetricsDashboard";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";

export default function App() {
  const { state, dispatch, canUndo, canRedo } = useAppState();
  const [openCard, setOpenCard] = React.useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [metricsDashboardOpen, setMetricsDashboardOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [metrics, setMetrics] = React.useState<MetricsState>(() => loadMetrics());
  const hasBgImage = !!state.settings.backgroundImage;

  // Keyboard shortcut for ? to show help
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

      <div className="app-shell h-full px-6 py-8">
        <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col">
          <Board
            cards={state.cards}
            columns={state.columns}
            settings={state.settings}
            metrics={metrics}
            onAdd={(column, title) => dispatch({ type: "ADD_CARD", column, title })}
            onMove={(id, to, patch) => dispatch({ type: "MOVE_CARD", id, to, patch })}
            onDelete={(id) => dispatch({ type: "DELETE_CARD", id })}
            onOpenCard={(c) => setOpenCard(c)}
            onSettings={() => setSettingsOpen(true)}
            onOpenMetrics={() => setMetricsDashboardOpen(true)}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => dispatch({ type: "UNDO" })}
            onRedo={() => dispatch({ type: "REDO" })}
          />
        </div>
      </div>

      <CardModal
        open={!!openCard}
        card={openCard ? state.cards.find((c) => c.id === openCard.id) ?? openCard : null}
        allCards={state.cards}
        onClose={() => setOpenCard(null)}
        onSave={(card) => {
          dispatch({ type: "UPDATE_CARD", card });
          setOpenCard(null);
        }}
        onDelete={(id) => {
          dispatch({ type: "DELETE_CARD", id });
          setOpenCard(null);
        }}
        onAddRelation={(cardId: string, targetCardId: string, relationType: RelationType) => {
          dispatch({ type: "ADD_RELATION", cardId, targetCardId, relationType });
        }}
        onRemoveRelation={(cardId: string, relationId: string) => {
          dispatch({ type: "REMOVE_RELATION", cardId, relationId });
        }}
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
      />

      <MetricsDashboard
        open={metricsDashboardOpen}
        metrics={metrics}
        onClose={() => setMetricsDashboardOpen(false)}
      />

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
