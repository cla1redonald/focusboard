import React from "react";
import { useAppState } from "./state";
import type { Card, Column } from "./types";
import { Board } from "../components/Board";
import { CardModal } from "../components/CardModal";
import { SettingsPanel } from "../components/SettingsPanel";

export default function App() {
  const { state, dispatch } = useAppState();
  const [openCard, setOpenCard] = React.useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const hasBgImage = !!state.settings.backgroundImage;

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
            onAdd={(column, title) => dispatch({ type: "ADD_CARD", column, title })}
            onMove={(id, to, patch) => dispatch({ type: "MOVE_CARD", id, to, patch })}
            onOpenCard={(c) => setOpenCard(c)}
            onSettings={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      <CardModal
        open={!!openCard}
        card={openCard}
        onClose={() => setOpenCard(null)}
        onSave={(card) => {
          dispatch({ type: "UPDATE_CARD", card });
          setOpenCard(null);
        }}
        onDelete={(id) => {
          dispatch({ type: "DELETE_CARD", id });
          setOpenCard(null);
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={state.settings}
        columns={state.columns}
        onClose={() => setSettingsOpen(false)}
        onChange={(settings) => dispatch({ type: "SET_SETTINGS", settings })}
        onUpdateColumn={(column: Column) => dispatch({ type: "UPDATE_COLUMN", column })}
        onAddColumn={(column: Omit<Column, "id" | "order">) => dispatch({ type: "ADD_COLUMN", column })}
        onDeleteColumn={(id: string, migrateCardsTo?: string) => dispatch({ type: "DELETE_COLUMN", id, migrateCardsTo })}
        onReorderColumns={(columns: Column[]) => dispatch({ type: "REORDER_COLUMNS", columns })}
      />
    </div>
  );
}
