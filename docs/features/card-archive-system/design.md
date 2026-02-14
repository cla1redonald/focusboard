# DESIGN DOCUMENT: Card Archive System

## Feature: Card Archive System

### User Story

Add card archive system with:
- Auto-archive completed cards when new month starts
- Manual archive button on individual cards
- Slide-out Archive panel to browse, search, and restore archived cards
- Archive count badge on board
- Nothing deleted - all cards preserved

### Technical Approach

**Architecture Pattern:** Hidden archive with timestamp-based filtering

The implementation adds a single optional field `archivedAt?: string` to the Card type. When set, the card is considered archived. The board view filters out archived cards using a memoized `activeCards` computation, while archived cards remain in the state for metrics and restore functionality.

**Key Design Decisions:**
1. **Timestamp over boolean** - `archivedAt` stores when the card was archived (ISO string)
2. **Calendar month boundary** - Auto-archive uses calendar months (not rolling 30 days)
3. **Immutable updates** - All reducer actions preserve object references for unchanged cards
4. **No storage migration** - New optional fields work with existing v4 localStorage
5. **Metrics preservation** - Archived cards remain in metrics for historical accuracy

### Files to Modify

1. `src/app/types.ts` - Add `archivedAt` to Card, `autoArchive` to Settings
2. `src/app/constants.ts` - Update DEFAULT_SETTINGS
3. `src/app/state.ts` - Add ARCHIVE_CARD, UNARCHIVE_CARD, AUTO_ARCHIVE_CARDS actions
4. `src/app/App.tsx` - activeCards memo, auto-archive effect, ArchivePanel integration
5. `src/app/exportImport.ts` - CSV/JSON export/import for archivedAt field
6. `src/components/CardModal.tsx` - Add archive button
7. `src/components/TopStrip.tsx` - Add archive badge and button
8. `src/components/Board.tsx` - Pass archive props through
9. `src/components/SettingsPanel.tsx` - Add auto-archive toggle
10. `src/components/CommandPalette.tsx` - Add "Open Archive" command

### Files to Create

11. `src/components/ArchivePanel.tsx` - Archive browsing UI (ALREADY EXISTS in HANDOFF.md)

### Testing Strategy

**Unit Tests (state.test.ts):**
- ARCHIVE_CARD sets archivedAt timestamp
- UNARCHIVE_CARD clears archivedAt, places at top of column
- AUTO_ARCHIVE_CARDS handles month boundaries, year rollover
- All actions are undoable
- Idempotency tests

**Component Tests (ArchivePanel.test.tsx):**
- Displays archived cards sorted by date
- Search and filter functionality
- Restore flow with column picker
- Empty states

**Integration Tests:**
- Auto-archive on app load with toast
- Manual archive from CardModal
- Restore to different column
- Export/import preserves archived cards

**Estimated Effort:** 10-13 hours total

### Critical Implementation Notes

**From HANDOFF.md Review Fixes:**
1. Auto-archive toast over-counts - use before/after delta
2. ARCHIVE_CARD needs guard for non-existent ID

**Implementation Order:**
1. Types + Constants (foundation)
2. Reducer actions (core logic)
3. App wiring (active/archived card memos)
4. UI components (buttons, badges, panel)
5. Export/Import (data portability)
6. Tests (verification)
