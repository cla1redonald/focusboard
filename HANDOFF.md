# HANDOFF.md - Card Archive Feature

## Feature: Card Archive System
**Started:** 2026-01-31
**Status:** Architecture Complete

---

## Phase: Plan (Complete)
**Agent:** @orchestrator
**Started:** 2026-01-31

### Requirements
- Cards in Done column auto-archive when a new month starts (previous month's cards)
- Manual archive button on individual cards for early cleanup
- Slide-out Archive panel to browse, search, and restore archived cards
- Archive count badge/indicator on the board
- Nothing is deleted - archived cards are preserved and accessible

### Decisions Made
1. Hidden archive + panel approach (not an archive column)
2. Calendar month boundary for auto-archive (not rolling period)

---

## Phase: Architecture (Complete)
**Agent:** @architect
**Completed:** 2026-01-31

---

# ARCHITECTURE: Card Archive System

## 1. Type Changes

### 1.1 Card Type Addition (`src/app/types.ts`, line 66)

Add one optional field to the existing `Card` type:

```typescript
export type Card = {
  // ... existing fields ...
  completedAt?: string;       // already exists (line 81)

  archivedAt?: string;        // NEW: ISO date when card was archived. Undefined = not archived.
  // ... rest of existing fields ...
};
```

**Why `archivedAt` and not `isArchived: boolean`:** The timestamp is strictly more useful. It tells us _when_ the card was archived (needed for archive panel sorting, "archived 3 days ago" labels). A truthiness check `!!card.archivedAt` serves as the boolean. One field, two uses.

**Placement:** Add after `completedAt` (line 81) to group lifecycle timestamps together.

### 1.2 Settings Type Addition (`src/app/types.ts`, line 133)

Add one field to the existing `Settings` type:

```typescript
export type Settings = {
  // ... existing fields ...
  theme: ThemeMode;                    // already exists (line 143)
  autoArchive: boolean;                // NEW: whether auto-archive runs on month boundary
};
```

### 1.3 DEFAULT_SETTINGS Update (`src/app/constants.ts`, line 67)

```typescript
export const DEFAULT_SETTINGS: Settings = {
  // ... existing defaults ...
  theme: "light",
  autoArchive: true,         // NEW: on by default (the expected behavior)
};
```

### 1.4 New Helper Type (optional, for archive panel)

No new standalone types are needed. The archive panel can filter the existing `Card[]` by `archivedAt !== undefined`. If we want to support archive-specific filtering in the UI, we can reuse the existing `FilterState` type for search and tag filtering on the archive panel. No new type required.

---

## 2. New Reducer Actions (`src/app/state.ts`)

### 2.1 Action Type Union (add to the `Action` type, line 31)

Add three new action types to the existing union:

```typescript
type Action =
  // ... existing actions ...
  | { type: "ARCHIVE_CARD"; id: string }
  | { type: "UNARCHIVE_CARD"; id: string; toColumn: ColumnId }
  | { type: "AUTO_ARCHIVE_CARDS" }
  | { type: "UNDO" }
  | { type: "REDO" };
```

### 2.2 ARCHIVE_CARD Reducer Case

```typescript
case "ARCHIVE_CARD": {
  const now = nowIso();
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === action.id
        ? { ...c, archivedAt: now, updatedAt: now }
        : c
    ),
  };
}
```

**Key behaviors:**
- Sets `archivedAt` to the current ISO timestamp
- Does NOT remove the card from the array (just marks it)
- Does NOT change the card's `column` field (preserves which column it was in when archived)
- Updates `updatedAt` so undo/redo history detects the change

### 2.3 UNARCHIVE_CARD Reducer Case

```typescript
case "UNARCHIVE_CARD": {
  const now = nowIso();
  const targetColumn = state.columns.find((col) => col.id === action.toColumn);
  if (!targetColumn) return state;

  // Shift existing cards in target column to make room at top
  const shiftedCards = state.cards.map((c) =>
    c.column === action.toColumn && !c.archivedAt
      ? { ...c, order: (c.order ?? 0) + 1 }
      : c
  );

  const transition: ColumnTransition = {
    from: null, // "from archive" - null signals non-column origin
    to: action.toColumn,
    at: now,
  };

  return {
    ...state,
    cards: shiftedCards.map((c) =>
      c.id === action.id
        ? {
            ...c,
            archivedAt: undefined,
            column: action.toColumn,
            order: 0,
            updatedAt: now,
            completedAt: targetColumn.isTerminal ? c.completedAt : undefined,
            columnHistory: [...(c.columnHistory ?? []), transition],
          }
        : c
    ),
  };
}
```

**Key behaviors:**
- Clears `archivedAt` (sets to `undefined`)
- Moves card to the chosen `toColumn`
- Places it at order 0 (top of column), shifts existing cards
- Adds a `ColumnTransition` entry to `columnHistory` with `from: null` (signals restored from archive)
- If restoring to a non-terminal column, clears `completedAt` (card is no longer "done")
- If restoring to a terminal column (rare edge case), preserves `completedAt`

### 2.4 AUTO_ARCHIVE_CARDS Reducer Case

```typescript
case "AUTO_ARCHIVE_CARDS": {
  if (!state.settings.autoArchive) return state;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const terminalColumnIds = new Set(
    state.columns.filter((c) => c.isTerminal).map((c) => c.id)
  );

  let hasChanges = false;
  const archiveTimestamp = nowIso();

  const updatedCards = state.cards.map((card) => {
    // Skip already archived cards
    if (card.archivedAt) return card;

    // Only archive cards in terminal columns
    if (!terminalColumnIds.has(card.column)) return card;

    // Only archive cards completed in a PREVIOUS month
    if (!card.completedAt) return card;

    const completedDate = new Date(card.completedAt);
    const completedMonth = completedDate.getMonth();
    const completedYear = completedDate.getFullYear();

    // Is the completion date in a previous calendar month?
    if (
      completedYear < currentYear ||
      (completedYear === currentYear && completedMonth < currentMonth)
    ) {
      hasChanges = true;
      return {
        ...card,
        archivedAt: archiveTimestamp,
        updatedAt: archiveTimestamp,
      };
    }

    return card;
  });

  if (!hasChanges) return state;
  return { ...state, cards: updatedCards };
}
```

**Key behaviors:**
- Respects the `autoArchive` setting -- returns early if disabled
- Only targets cards in terminal columns (`isTerminal: true`)
- Only archives cards whose `completedAt` is in a PREVIOUS calendar month
- Uses calendar month boundary (not rolling 30 days)
- Skips cards that are already archived
- Returns unchanged state reference if nothing to archive (important for history)

---

## 3. Auto-Archive Trigger Logic

### 3.1 Where It Fires (`src/app/App.tsx`)

Add a new `useEffect` in `AppContent` (similar to the existing `APPLY_AUTO_PRIORITIES` effect at line 146):

```typescript
// Auto-archive completed cards from previous months
React.useEffect(() => {
  dispatch({ type: "AUTO_ARCHIVE_CARDS" });
}, []); // Run once on mount (app load / page refresh)
```

**Why only on mount:**
- The requirement is "when app loads in a new month, archive all Done cards from previous months"
- Running once per page load is sufficient -- users open the app daily
- No need for an interval (unlike auto-priority which checks hourly) because month boundaries don't change mid-session
- The reducer itself is idempotent -- calling it when there's nothing to archive returns the same state reference

**No separate "last auto-archive date" tracking needed.** The reducer checks each card's `completedAt` against the current calendar month. If a card was already archived, it skips it. Running the action multiple times per month is harmless (no cards match, state unchanged, no history entry).

### 3.2 Month Boundary Detection (Inside the Reducer)

The detection is embedded in the `AUTO_ARCHIVE_CARDS` case above. The logic is:

```
Is completedYear < currentYear?  --> archive
Is completedYear === currentYear AND completedMonth < currentMonth?  --> archive
Otherwise  --> skip
```

This handles year transitions correctly. A card completed December 2025 will be archived when the app loads in January 2026.

---

## 4. Board-Level Filtering: Hiding Archived Cards

### 4.1 Critical Change: Filter Archived Cards from Board View

**In `src/app/App.tsx`**, where `state.cards` is passed to `<Board>`, filter out archived cards:

```typescript
// Compute active (non-archived) cards for the board
const activeCards = React.useMemo(
  () => state.cards.filter((c) => !c.archivedAt),
  [state.cards]
);
```

Then pass `activeCards` instead of `state.cards` to `<Board>` and to `<CardModal>` `allCards`, `<CommandPalette>`, `<FocusSuggestionPanel>`, `<WeeklyPlanPanel>`, etc.

**Files that receive cards and must use the filtered set:**
- `Board` component (line 176)
- `CardModal` `allCards` prop (line 235)
- `CommandPalette` `cards` prop (line 402)
- `FocusSuggestionPanel` `cards` prop (line 339)
- `WeeklyPlanPanel` `cards` prop (line 368)
- `TimelinePanel` `cards` prop (line 323)

**Files that should still receive ALL cards (including archived) for metrics:**
- `MetricsDashboard` should receive `state.cards` (unfiltered) -- see section 7

### 4.2 Daily Snapshot Consideration

In `App.tsx` line 96, `takeDailySnapshot(state.cards, ...)` should use `activeCards` (not all cards) so that column counts reflect visible cards:

```typescript
const updated = takeDailySnapshot(activeCards, state.columns, metrics);
```

### 4.3 Status Bar Counts

The Board's subtitle line (line 449) counts non-terminal cards. Since Board already receives filtered `activeCards`, the count will automatically exclude archived cards with no code change in Board.tsx.

---

## 5. Storage Considerations

### 5.1 No Version Bump Needed

**Decision: No storage migration required.**

Rationale:
- The new `archivedAt` field on Card is **optional** (`archivedAt?: string`)
- Existing cards loaded from v4 localStorage will simply not have this field, which means they are not archived -- correct behavior
- The new `autoArchive` field on Settings is also optional at the storage level
- The `loadState()` function in `storage.ts` already applies `{ ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }` (line 318), so old saved settings without `autoArchive` will get `autoArchive: true` from defaults

**Modifications to `storage.ts`:**
- None required for the new Card field
- None required for the new Settings field (already handled by spread with defaults)

### 5.2 Export/Import (`src/app/exportImport.ts`)

Two small additions:

**In `validateCards` function (line 244):**
Add validation for the new optional field, after the other optional field validations (around line 309):

```typescript
if (typeof card.archivedAt === "string") validCard.archivedAt = card.archivedAt;
```

**In `validateSettings` function (line 469):**
Add validation for the new setting:

```typescript
autoArchive: typeof obj.autoArchive === "boolean" ? obj.autoArchive : DEFAULT_SETTINGS.autoArchive,
```

**In `exportToCsv` function (line 36):**
Add `archivedAt` to CSV headers and row data:
- Add `"archivedAt"` to headers array
- Add `escapeCell(card.archivedAt)` to row array

### 5.3 localStorage Size Consideration

Archived cards remain in the `cards` array in localStorage. This is acceptable because:
- FocusBoard already caps metrics at 500 completed cards and 90 daily snapshots
- Kanban boards typically process 10-30 cards per month
- Even after a year, ~300 archived cards is well within localStorage limits
- If size becomes an issue in the future, we can add a "purge archived cards older than X months" feature (not needed now)

---

## 6. Undo/Redo Implications

### 6.1 ARCHIVE_CARD and UNARCHIVE_CARD: Fully Undoable

These actions flow through `historyReducer` exactly like every other action (line 594-604 of state.ts):
1. `historyReducer` calls `appReducer(present, action)` to produce `newPresent`
2. If state changed, pushes current `present` onto `past` array, clears `future`
3. Undo pops from `past`, push current to `future`

**No special handling needed.** The undo of an ARCHIVE_CARD restores the previous state where `archivedAt` was undefined, making the card reappear on the board. The undo of an UNARCHIVE_CARD restores `archivedAt`, removing it from the board again.

### 6.2 AUTO_ARCHIVE_CARDS: Intentionally Creates a Single History Entry

When auto-archive runs on mount and archives, say, 5 cards, it creates ONE history entry (one state transition). A single Ctrl+Z will undo the entire batch auto-archive. This is the correct UX -- if the user didn't expect cards to vanish, one undo brings them all back.

**Edge case:** If auto-archive finds nothing to archive, `appReducer` returns the same state reference (line 598 check: `if (newPresent === present) return historyState`). No history entry is created. This is the correct behavior.

### 6.3 Toast Notification for Auto-Archive

When AUTO_ARCHIVE_CARDS runs and archives cards, show a toast with undo:

```typescript
// In App.tsx, after the auto-archive dispatch
React.useEffect(() => {
  const terminalColumnIds = new Set(
    state.columns.filter((c) => c.isTerminal).map((c) => c.id)
  );
  const archivedCount = state.cards.filter(
    (c) => c.archivedAt && terminalColumnIds.has(c.column)
  ).length;

  // Show toast on first render if there are archived cards
  // (The actual archiving is handled by the dispatch)
  if (archivedCount > 0 && state.settings.autoArchive) {
    showToast({
      type: "info",
      message: `Auto-archived ${archivedCount} completed card${archivedCount > 1 ? "s" : ""} from last month`,
      undoAction: () => dispatch({ type: "UNDO" }),
    });
  }
}, []); // Only on mount
```

**Engineer note:** This toast logic should be careful -- it should only fire once on mount, not re-fire on every render. Use a ref to track whether the toast has been shown.

---

## 7. Key Decision: Should Archived Cards Count in Metrics?

### Decision: YES -- archived cards SHOULD count in completed card metrics.

**Rationale:**

Metrics measure historical performance. Archiving is a UI organization action, not a "undo completion" action. A card that was completed and then archived was still genuinely completed. Removing it from metrics would:
- Deflate throughput numbers
- Break cycle time averages
- Make the burndown chart lose data points
- Create confusing jumps in the cumulative flow diagram

**What this means for implementation:**

The metrics system (`src/app/metrics.ts`) is **already isolated from archiving** because:
1. `recordCompletedCard` (line 100) is called in `App.tsx` when a card moves to a terminal column (line 104-129). This happens BEFORE any archiving.
2. `MetricsState.completedCards` stores snapshots of card data (cardId, title, createdAt, completedAt, etc.) -- it does not reference the live card objects.
3. Auto-archive runs on mount; metrics recording runs on card state change. No conflict.

**No changes to `metrics.ts` are needed.**

**However, the `MetricsDashboard` component should receive unfiltered cards** for:
- `getStaleCards()` -- should exclude archived (use activeCards)
- `getColumnAgeStats()` -- should exclude archived (use activeCards)
- `getBlockedTimeAnalysis()` -- should exclude archived (use activeCards)
- `getCumulativeFlowData()` -- already uses `dailySnapshots`, not live cards -- no change needed

In `App.tsx`, pass `activeCards` to MetricsDashboard for the `cards` prop, since column-based analytics should only show active cards. The `metrics` prop (CompletedCardMetric[]) remains unfiltered as it's separate.

### Summary Table

| Metric / Feature | Uses Archived Cards? | Why |
|---|---|---|
| Throughput (cards/week) | YES | Based on `MetricsState.completedCards`, not live cards |
| Avg Lead Time | YES | Same reason |
| Avg Cycle Time | YES | Same reason |
| Daily Snapshot counts | NO | Snapshots count board-visible cards per column |
| Stale card analysis | NO | Only relevant for active board cards |
| Column age stats | NO | Only relevant for active board cards |
| Blocked time analysis | NO | Only relevant for active board cards |
| Burndown chart | YES | Based on `MetricsState.completedCards` |
| Cumulative flow | Depends | Uses `dailySnapshots` which are point-in-time |
| Completion streak | YES | Based on `MetricsState.lastCompletionDate` |

---

## 8. Supabase Sync Impact

### 8.1 Schema Changes: NONE

The Supabase schema (`supabase/schema.sql`) stores the entire `AppState` as a JSONB column:

```sql
CREATE TABLE IF NOT EXISTS app_state (
  user_id UUID PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}',
  ...
);
```

Since `archivedAt` is just a new optional field inside the cards array within the JSONB blob, **no SQL migration is needed**. The existing `saveStateToSupabase` and `loadStateFromSupabase` functions (in `sync.ts`) serialize/deserialize the full `AppState` including the new field automatically.

### 8.2 Real-Time Sync Behavior

The real-time subscription in `state.ts` (line 670) will propagate archive/unarchive actions across devices via the existing JSONB update flow. No changes needed.

### 8.3 Storage Bucket: No Impact

Card attachments (`supabase/storage-bucket.sql`) are tied to card IDs, not archive status. Archived cards retain their attachments. When a card is permanently deleted (not archived), the existing `cleanupCardAttachments` function handles attachment removal.

---

## 9. Files to Modify (Implementation Checklist for @engineer)

| # | File | Change | Complexity |
|---|---|---|---|
| 1 | `src/app/types.ts` | Add `archivedAt?: string` to Card type (after line 81) | Minimal |
| 2 | `src/app/types.ts` | Add `autoArchive: boolean` to Settings type (after line 143) | Minimal |
| 3 | `src/app/constants.ts` | Add `autoArchive: true` to DEFAULT_SETTINGS (after line 76) | Minimal |
| 4 | `src/app/state.ts` | Add ARCHIVE_CARD, UNARCHIVE_CARD, AUTO_ARCHIVE_CARDS to Action type and appReducer | Medium |
| 5 | `src/app/App.tsx` | Add `activeCards` memo, use for Board/panels; add auto-archive useEffect; add toast | Medium |
| 6 | `src/app/exportImport.ts` | Add `archivedAt` to card validation; add `autoArchive` to settings validation; update CSV export | Low |
| 7 | `src/components/SettingsPanel.tsx` | Add auto-archive toggle in Analytics section | Low |
| 8 | `src/components/ArchivePanel.tsx` | **NEW FILE** - Slide-out panel to browse/search/restore archived cards | Medium-High |
| 9 | `src/components/CardModal.tsx` | Add "Archive" button (next to delete) for cards in terminal columns | Low |
| 10 | `src/components/TopStrip.tsx` | Add archive count badge and button to open ArchivePanel | Low |
| 11 | `src/components/Board.tsx` | Add `onOpenArchive` prop, pass through to TopStrip | Minimal |
| 12 | `src/components/CommandPalette.tsx` | Add "Open Archive" command | Minimal |

### New File: ArchivePanel.tsx

This is the only new file. It should be lazy-loaded (like MetricsDashboard). Spec:

```
ArchivePanel
  Props:
    - open: boolean
    - archivedCards: Card[]           // filtered by archivedAt !== undefined
    - columns: Column[]              // for showing where card was when archived
    - tags: Tag[]                    // for tag display
    - onClose: () => void
    - onUnarchive: (id: string, toColumn: ColumnId) => void
    - onOpenCard: (card: Card) => void
    - onDeletePermanently?: (id: string) => void  // optional, for future

  Features:
    - Search by title/notes (reuse matchesSearch logic from filters.ts)
    - Filter by month archived
    - Sort by archivedAt (newest first)
    - Each card shows: title, icon, archived date, original column name
    - "Restore" button opens a column picker dropdown, then calls onUnarchive
    - Empty state: "No archived cards yet"
```

---

## 10. Implementation Order (Recommended for @engineer)

1. **Types + Constants** (files 1-3): Add the new fields. All other files depend on these.
2. **Reducer actions** (file 4): Implement ARCHIVE_CARD, UNARCHIVE_CARD, AUTO_ARCHIVE_CARDS.
3. **App.tsx wiring** (file 5): Add `activeCards` memo, auto-archive effect, pass to components.
4. **CardModal archive button** (file 9): Quick win - "Archive" button on done cards.
5. **ArchivePanel** (file 8): Build the new panel component.
6. **TopStrip + Board** (files 10-11): Wire up the archive badge and panel opener.
7. **SettingsPanel** (file 7): Add the auto-archive toggle.
8. **Export/Import** (file 6): Update validation for new fields.
9. **CommandPalette** (file 12): Add "Open Archive" command.

---

## 11. Testing Considerations for @qa

### Unit Tests
- `ARCHIVE_CARD` sets `archivedAt`, preserves other fields
- `UNARCHIVE_CARD` clears `archivedAt`, moves to target column, adds columnHistory entry
- `UNARCHIVE_CARD` to non-terminal column clears `completedAt`
- `AUTO_ARCHIVE_CARDS` only archives terminal-column cards from previous months
- `AUTO_ARCHIVE_CARDS` skips already-archived cards
- `AUTO_ARCHIVE_CARDS` respects `autoArchive: false` setting
- `AUTO_ARCHIVE_CARDS` returns same state reference when nothing to archive
- Month boundary edge cases: Dec -> Jan year transition, Feb 28/29 edge
- Undo after ARCHIVE_CARD restores the card to the board
- Undo after AUTO_ARCHIVE_CARDS restores all batch-archived cards

### Integration Tests
- Archived cards do not appear in board columns
- Archived cards do not appear in FilterBar results
- Archived cards do appear in ArchivePanel
- Unarchived card appears at top of chosen column
- Auto-archive fires on app load and shows toast with undo
- Archive count badge in TopStrip matches actual archived count
- Export includes `archivedAt` field; import preserves it

### Edge Cases
- Card with no `completedAt` in a terminal column (legacy data) -- should still be archivable manually
- Card archived, then re-opened from archive panel (should show read-only or allow editing before restore)
- Multiple rapid archive/unarchive cycles -- undo history should remain coherent

---

## 12. Security Considerations

- **No new auth concerns:** Archive/unarchive are state mutations on the existing cards array, protected by the same Supabase RLS policies
- **No new API endpoints:** Everything stays client-side with JSONB sync
- **XSS:** No new user-input fields beyond existing card data
- **Data preservation:** Archive is reversible; no data is deleted

---

## @architect -> @engineer
**Status:** COMPLETE
**Deliverables:** HANDOFF.md (this document)
**Summary:** Card archive system adds `archivedAt` to Card type, `autoArchive` to Settings, three new reducer actions (ARCHIVE_CARD, UNARCHIVE_CARD, AUTO_ARCHIVE_CARDS), and one new component (ArchivePanel.tsx). No storage migration needed. No Supabase schema changes. Metrics remain unaffected. Undo/redo works automatically.

**Notes for @engineer:**
- Database: No changes needed (JSONB blob absorbs the new field)
- Auth: No changes
- Storage: No migration (new fields are optional)
- Hardest part: ArchivePanel.tsx (new file, lazy-loaded, with search/filter/restore UX)
- Watch out for: Ensure ALL places that iterate `state.cards` for board display use `activeCards` (the filtered set). Grep for `state.cards` in App.tsx and Board.tsx to catch them all.
- The auto-archive toast with undo needs a ref guard to prevent re-firing.

---

## @engineer -> @reviewer
**Status:** COMPLETE
**Completed:** 2026-01-31

### Deliverables

All 12 files from the architecture checklist have been implemented:

### Files Modified

1. **`src/app/types.ts`** - Added `archivedAt?: string` to Card type (line 82), `autoArchive: boolean` to Settings type (line 143)
2. **`src/app/constants.ts`** - Added `autoArchive: true` to DEFAULT_SETTINGS (line 77)
3. **`src/app/state.ts`** - Added three new action types (ARCHIVE_CARD, UNARCHIVE_CARD, AUTO_ARCHIVE_CARDS) to Action union and implemented all three reducer cases
4. **`src/app/App.tsx`** - Added `activeCards` memo, auto-archive useEffect with ref guard, auto-archive toast, ArchivePanel lazy import + Suspense wrapper, wired all panels to use `activeCards`, added onArchive handler to CardModal, onOpenArchive to CommandPalette
5. **`src/app/exportImport.ts`** - Added `archivedAt` to CSV headers + row data, added `archivedAt` to card validation, added `autoArchive` to settings validation
6. **`src/components/CardModal.tsx`** - Added `columns` and `onArchive` props, added Archive button in footer (available on all cards)
7. **`src/components/ArchivePanel.tsx`** - **NEW FILE** - Slide-out panel with search, month filter, sort by archivedAt desc, restore-to-column picker, empty states, tag display, dark mode support
8. **`src/components/TopStrip.tsx`** - Added `archivedCount` and `onOpenArchive` props, Archive button with count badge
9. **`src/components/Board.tsx`** - Added `archivedCount` and `onOpenArchive` props, passed through to TopStrip
10. **`src/components/SettingsPanel.tsx`** - Added auto-archive on/off toggle in Analytics section
11. **`src/components/CommandPalette.tsx`** - Added "Open Archive" quick action, added `onOpenArchive` prop

### Tests Added

- **`src/app/state.test.ts`** - Added test suites for:
  - ARCHIVE_CARD (4 tests): sets archivedAt, preserves fields, updates timestamp, is undoable
  - UNARCHIVE_CARD (5 tests): clears archivedAt, clears completedAt on non-terminal, places at top, adds columnHistory, handles invalid column
  - AUTO_ARCHIVE_CARDS (6 tests): archives previous month cards, skips current month, skips already archived, respects disabled setting, skips non-terminal columns, returns same state when nothing to archive
- Updated SET_SETTINGS test to include new `autoArchive` field

### Architecture Adherence Notes

- `archivedAt` is a string timestamp (not boolean) per architecture
- AUTO_ARCHIVE_CARDS returns same state reference when nothing to archive (no empty history entries)
- UNARCHIVE_CARD clears `completedAt` when restoring to non-terminal column
- Manual archive works on ANY card (not just terminal column cards) via CardModal
- ArchivePanel is lazy-loaded like MetricsDashboard
- `activeCards` used for Board, CardModal, CommandPalette, FocusSuggestionPanel, WeeklyPlanPanel, TimelinePanel, MetricsDashboard, and takeDailySnapshot
- `state.cards` (unfiltered) used for ArchivePanel's archivedCards filter and archivedCount
- Auto-archive toast uses ref guard (`autoArchiveToastShown`) to prevent re-firing
- Undo/redo works automatically through existing historyReducer

### For @reviewer

- **Key files to review:** `src/app/state.ts` (new reducer cases), `src/app/App.tsx` (wiring), `src/components/ArchivePanel.tsx` (new component)
- **Areas of concern:** The auto-archive toast logic checks if `archivedAt` starts with today's date to only show on fresh archives; this could miss edge cases around midnight UTC
- **Security-sensitive code:** None - all client-side state mutations on existing cards array

---

## Code Review: Card Archive System

**Reviewer:** @reviewer
**Date:** 2026-01-31
**Files Reviewed:** 11 modified + 1 new (ArchivePanel.tsx)
**Tests:** 82 tests passing (15 new archive tests)

### Summary

Solid implementation that closely follows the architecture spec. The reducer logic is correct and immutable, the UI wiring is thorough, and test coverage for the state layer is good. Two issues need attention before deployment -- one is a real bug, one is a quality concern. Several non-blocking improvements would harden edge cases and polish UX.

---

### MUST FIX (Blocking Deployment)

#### 1. Auto-archive toast over-counts archived cards

- **File:** `/Users/clairedonald/focusboard/src/app/App.tsx`, lines 179-195
- **Issue:** The toast notification counts ALL cards with `archivedAt` matching today's date, not just the cards that were JUST auto-archived. If a user manually archived 3 cards earlier today, and then auto-archive runs and archives 2 more, the toast will say "Auto-archived 5 completed cards from last month" instead of 2. This is misleading and confuses the undo -- pressing undo only undoes the batch auto-archive (2 cards), not the manual ones.
- **Root cause:** `justArchived` filters all cards where `c.archivedAt.startsWith(today)`, which includes manually archived cards from the same day.
- **Suggestion:** Capture the count of archived cards before and after the `AUTO_ARCHIVE_CARDS` dispatch, and use the delta as the toast count. Alternatively, compare `state.cards` from before and after the dispatch to count only newly-archived cards. The simplest fix: compute `justArchivedCount` by checking the card count before/after the dispatch in the auto-archive effect.

#### 2. ARCHIVE_CARD does not guard against non-existent card ID

- **File:** `/Users/clairedonald/focusboard/src/app/state.ts`, lines 567-577
- **Issue:** If `ARCHIVE_CARD` is dispatched with an ID that does not match any card, the reducer still returns a new state object (via `.map()` which produces a new array). This creates a spurious undo history entry for a no-op action. Compare with `UNARCHIVE_CARD` (line 582) which guards against an invalid `toColumn` by returning `state` unchanged -- no equivalent guard exists for a missing card in `ARCHIVE_CARD`.
- **Suggestion:** Add an early-return guard:
  ```typescript
  case "ARCHIVE_CARD": {
    if (!state.cards.some((c) => c.id === action.id)) return state;
    // ...rest of logic
  }
  ```
  This prevents empty undo history entries and matches the defensive pattern used elsewhere in the reducer.

---

### SHOULD FIX (Improve Quality)

#### 3. Auto-archive toast races with state update

- **File:** `/Users/clairedonald/focusboard/src/app/App.tsx`, lines 170-196
- **Issue:** The auto-archive dispatch (line 171) and the toast effect (lines 175-196) are in separate `useEffect` hooks. The toast effect depends on `state.cards` changing, but there is a timing question: React batches state updates, so the toast effect may fire on the initial render before `AUTO_ARCHIVE_CARDS` has been processed. The `startsWith(today)` check partially mitigates this, but the separation makes reasoning about order fragile. This is also the root of the @engineer's flagged concern about midnight UTC -- if the app loads at 23:59 UTC and the auto-archive sets `archivedAt` to "2026-01-31T23:59:59Z", but the toast checks against `today` which could already be "2026-02-01" in a different timezone, the toast comparison could fail.
- **Suggestion:** Combine the auto-archive dispatch and toast logic into a single effect. Capture a "before count" snapshot, dispatch, and use a ref to pass the delta to the toast. This eliminates the race and the midnight edge case.

#### 4. ArchivePanel does not handle Escape key to close

- **File:** `/Users/clairedonald/focusboard/src/components/ArchivePanel.tsx`
- **Issue:** Other modal/panel components in this codebase (CommandPalette, CardModal, SettingsPanel) handle the Escape key to close. ArchivePanel does not. This is an inconsistency that affects keyboard-only users and general UX expectations.
- **Suggestion:** Add a `useEffect` listener for `keydown` on `Escape` that calls `onClose()`, similar to the pattern in other panels.

#### 5. ArchivePanel `restoreColumns` computed but not used

- **File:** `/Users/clairedonald/focusboard/src/components/ArchivePanel.tsx`, line 103
- **Issue:** `restoreColumns` (non-terminal columns) is computed on line 103 but never referenced. Only `allColumns` (line 104) is used for the restore picker. This is dead code.
- **Suggestion:** Remove the unused `restoreColumns` variable. The current behavior of showing all columns in the restore picker is arguably correct since a user might want to restore to any column.

#### 6. UNARCHIVE_CARD does not reset swimlane

- **File:** `/Users/clairedonald/focusboard/src/app/state.ts`, lines 579-612
- **Issue:** When unarchiving, the card keeps whatever swimlane it had when archived. The architecture spec does not mention swimlane handling, but the restore UI does not let the user pick a swimlane either. If a card was in the "personal" swimlane when archived and gets restored, it silently goes back to "personal". This may surprise users who expect restored cards to appear in the default "work" swimlane.
- **Suggestion:** This is a design decision rather than a bug. At minimum, document this behavior. Optionally, add the swimlane to the `UNARCHIVE_CARD` action type so the restore picker can include swimlane selection.

#### 7. Duplicate archived count computation

- **File:** `/Users/clairedonald/focusboard/src/app/App.tsx`, lines 179 and 220
- **Issue:** `state.cards.filter((c) => c.archivedAt).length` is computed twice -- once in the toast effect (line 179) and once inline in the Board props (line 220). The `!!c.archivedAt` variant at line 220 is functionally identical but uses a different truthiness style. Additionally, line 454 computes the same filter a third time for ArchivePanel props.
- **Suggestion:** Compute `archivedCards` once with `useMemo` (similar to how `activeCards` is memoized) and derive the count from it. Pass the array to ArchivePanel and the count to Board.

---

### NICE TO HAVE (Optional Improvements)

#### 8. No aria-label on ArchivePanel backdrop for accessibility

- **File:** `/Users/clairedonald/focusboard/src/components/ArchivePanel.tsx`, line 108
- **Suggestion:** Add `role="dialog"` and `aria-label="Archive panel"` to the panel container, and `aria-hidden="true"` to the backdrop overlay. This improves screen reader experience.

#### 9. ArchivePanel search could debounce input

- **File:** `/Users/clairedonald/focusboard/src/components/ArchivePanel.tsx`, line 134
- **Issue:** Every keystroke re-filters the full archived cards list. For a small archive this is fine, but if someone archives 200+ cards over a year, this could become sluggish.
- **Suggestion:** Consider debouncing the search input by 150-200ms if performance becomes a concern. Not needed now, but good to note for the future.

#### 10. Tests could cover the year-boundary edge case (Dec to Jan)

- **File:** `/Users/clairedonald/focusboard/src/app/state.test.ts`
- **Issue:** The architecture spec specifically calls out "Dec -> Jan year transition" as an edge case to test. The current tests use `lastMonth.setMonth(lastMonth.getMonth() - 1)` which works for most months but does not explicitly test the year rollover scenario (e.g., completedAt in December 2025 being archived when the current date is January 2026).
- **Suggestion:** Add one explicit test with a hardcoded `completedAt: "2025-12-15T10:00:00.000Z"` and a mocked current date in January 2026 to confirm the year-boundary logic works.

#### 11. Toast message says "from last month" but auto-archive covers ALL previous months

- **File:** `/Users/clairedonald/focusboard/src/app/App.tsx`, line 191
- **Issue:** The toast says "Auto-archived N completed cards from last month" but AUTO_ARCHIVE_CARDS archives cards from ANY previous month, not just last month. If someone has cards from three months ago that were never archived (e.g., auto-archive was disabled and then re-enabled), the toast message would be inaccurate.
- **Suggestion:** Change the message to "Auto-archived N completed cards from previous months" (plural).

---

### Security Check

- [PASS] Input validation: No new user-facing input fields that are rendered unsanitized. The search field in ArchivePanel is used only as a filter string with `.toLowerCase().includes()`, not injected into HTML.
- [N/A] Auth/authz: No new API endpoints. All mutations are client-side state changes protected by existing Supabase RLS.
- [PASS] Data exposure: No sensitive data exposed. `archivedAt` is a timestamp, not user-sensitive.
- [PASS] Secrets handling: No secrets involved.
- [PASS] XSS: Card titles and notes displayed in ArchivePanel use React's default escaping. No `dangerouslySetInnerHTML`.

---

### Test Coverage Assessment

**Current coverage (15 new tests):**
- ARCHIVE_CARD: 4 tests -- good coverage of core behavior and undo
- UNARCHIVE_CARD: 5 tests -- good coverage including edge cases (invalid column, non-terminal restore, column history)
- AUTO_ARCHIVE_CARDS: 6 tests -- covers previous month, current month, already archived, disabled setting, non-terminal, no-op

**Gaps identified:**
- No test for archiving a card that is ALREADY archived (double-archive). Currently the reducer would overwrite `archivedAt` with a new timestamp -- this is probably fine but should be explicitly tested or guarded.
- No test for year-boundary transition (Dec -> Jan) as noted above.
- No integration-level test for the `activeCards` memo (verifying archived cards are excluded from board props).
- No test for ARCHIVE_CARD with non-existent ID (relates to Must Fix #2).

---

### Verdict

**APPROVE WITH CHANGES**

The two Must Fix items should be addressed before deployment:
1. Fix the auto-archive toast count to only show freshly auto-archived cards (not all cards archived today)
2. Add the missing guard in ARCHIVE_CARD for non-existent card IDs

The Should Fix items (especially #3 toast race condition and #4 Escape key) are recommended but not blocking. The implementation is well-structured, follows existing patterns, and the test suite provides good confidence in the reducer logic.

---

## @reviewer -> @engineer
**Status:** APPROVE WITH CHANGES
**Blocking issues:** 2
**Non-blocking issues:** 5
**Nice-to-have:** 4

**For @engineer:**
- Must Fix #1 (toast over-count) is the highest priority -- it directly affects user-facing behavior
- Must Fix #2 (missing guard) is a quick one-liner
- Should Fix #3 and #1 can be addressed together by refactoring the two effects into one
- Should Fix #5 is a simple dead code removal

**For @qa:**
- Test focus areas: auto-archive toast accuracy, year-boundary auto-archive, double-archive scenario
- Risky code paths: the two-effect auto-archive + toast pattern in App.tsx lines 168-196
- The `activeCards` memo is a critical correctness point -- verify archived cards never appear in board columns

---

## Documentation: Drag-and-Drop Performance Optimizations

**Agent:** @docs
**Date:** 2026-02-03

### Task

Document the drag-and-drop performance optimizations across 5 source files (`CardItem.tsx`, `Column.tsx`, `Swimlane.tsx`, `state.ts`, `App.tsx`).

### What Was Updated

**File modified:** `ARCHITECTURE.md`

1. **Drag and Drop section** -- Added a "Performance" callout beneath the existing `@dnd-kit` component diagram. Explains why this code path is render-sensitive and cross-references the new Performance section.

2. **Performance Considerations section** -- Replaced the previous 5-bullet summary with a comprehensive "Performance" section covering:
   - General strategies (code splitting, memoization, state updates, storage writes)
   - Five numbered subsections for each drag-and-drop optimization:
     1. Component memoization (`React.memo` on `CardItem` and `Column`)
     2. Reference-preserving `MOVE_CARD` reducer (single-pass, `return c` for unchanged cards)
     3. Stable callback references in `Swimlane` (`useCallback` / `useMemo`)
     4. Framer Motion `layout` prop removal and `AnimatePresence` mode change
     5. O(n) Map-based metrics completion tracking (replacing O(n^2) `find()` loop)
   - Summary table mapping each file to its optimization and effect

### What Was NOT Changed

- `docs/API.md` -- No drag-and-drop or performance content; no update needed
- `docs/SUPABASE.md` -- No drag-and-drop or performance content; no update needed
- No new files were created; all documentation was added to the existing `ARCHITECTURE.md`

### Quality Checklist

- [x] Existing docs updated (not new files created unnecessarily)
- [x] Changes are scannable (headers, bullets, code blocks, summary table)
- [x] No outdated information left behind (old "Performance Considerations" bullets replaced)
- [x] Code examples match actual source (verified against current `CardItem.tsx`, `Column.tsx`, `Swimlane.tsx`, `state.ts`, `App.tsx`)
- [x] No hardcoded counts that could drift
- [x] Completion log written to HANDOFF.md
