import type { AppState } from "./types";
import { DEFAULT_SETTINGS } from "./constants";

const KEY = "focusboard:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cards: [], settings: DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as AppState;
    return {
      cards: parsed.cards ?? [],
      settings: parsed.settings ?? DEFAULT_SETTINGS,
    };
  } catch {
    return { cards: [], settings: DEFAULT_SETTINGS };
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state));
}
