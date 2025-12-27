const EMPTY_STATES: Record<string, { emoji: string; message: string }> = {
  backlog: { emoji: "📋", message: "Ideas live here" },
  design: { emoji: "✨", message: "Ready for planning" },
  todo: { emoji: "📝", message: "Nothing queued" },
  doing: { emoji: "🎯", message: "Focus mode" },
  blocked: { emoji: "🌤️", message: "All clear!" },
  done: { emoji: "🏆", message: "Celebrate wins" },
};

const DEFAULT_STATE = { emoji: "📭", message: "No cards yet" };

export function EmptyColumnState({ columnId }: { columnId: string }) {
  const state = EMPTY_STATES[columnId] ?? DEFAULT_STATE;

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span className="text-3xl">{state.emoji}</span>
      <span className="mt-2 text-sm text-emerald-700/50">{state.message}</span>
    </div>
  );
}
