# Card Archive System - Test Report

**Date:** 2026-02-14
**Test Agent:** Claude Sonnet 4.5
**Approach:** Test-Driven Development (TDD)

## Summary

Created comprehensive edge case tests for the Card Archive System. Tests are written to **fail before implementation** (TDD red-green-refactor cycle).

### Test Results

**Total Tests:** 14 edge case tests (additional to 15 existing tests in state.test.ts)
**Passing:** 13/14 (93%)
**Failing:** 1/14 (7%)

## Test File

**Location:** `/Users/clairedonald/focusboard/src/app/state-archive-edge-cases.test.ts`

### Test Coverage

#### ARCHIVE_CARD Edge Cases (3 tests)
1. ✅ **Invalid ID Guard** - Handles archiving non-existent card gracefully
2. ❌ **Idempotency** - Archiving already-archived card preserves original timestamp (FAILING - BUG FOUND!)
3. ✅ **Undo/Redo** - Can be redone after undo

#### UNARCHIVE_CARD Edge Cases (3 tests)
4. ✅ **Invalid ID Guard** - Handles unarchiving non-existent card gracefully
5. ✅ **Not Archived Guard** - Handles unarchiving card that is not archived
6. ✅ **Undo/Redo** - Can be redone after undo

#### AUTO_ARCHIVE_CARDS Edge Cases (5 tests)
7. ✅ **Year Boundary** - Correctly handles December to January transitions
8. ✅ **No completedAt Field** - Does not crash on cards without completedAt
9. ✅ **Bulk Archiving** - Efficiently handles multiple cards at month boundary
10. ✅ **Undo/Redo** - Can be undone and redone
11. ✅ **Idempotency** - Running twice does not double-archive or change timestamps

#### Month Boundary Calculations (3 tests)
12. ✅ **Same Month, Different Years** - Correctly identifies cards from previous years
13. ✅ **First Day of Month** - Does not archive cards completed on first day of current month
14. ✅ **Last Day of Month** - Archives cards completed on last day of previous month

## Bug Found 🐛

### ARCHIVE_CARD Idempotency Bug

**Test:** `is idempotent - archiving already archived card does not change archivedAt`

**Expected Behavior:**
```typescript
// First archive
dispatch({ type: "ARCHIVE_CARD", id: cardId });
const firstArchivedAt = card.archivedAt; // "2026-02-14T23:37:03.770Z"

// Second archive (5 seconds later) - should be no-op
dispatch({ type: "ARCHIVE_CARD", id: cardId });
expect(card.archivedAt).toBe(firstArchivedAt); // Should remain unchanged
```

**Actual Behavior:**
```typescript
// Second archive updates the timestamp (not idempotent!)
card.archivedAt: "2026-02-14T23:37:08.770Z" // Changed from 03 to 08 seconds
```

**Root Cause:**
Current implementation in `state.ts` (line 567-579) always sets a new `archivedAt` timestamp without checking if card is already archived:

```typescript
case "ARCHIVE_CARD": {
  const card = state.cards.find((c) => c.id === action.id);
  if (!card) return state;
  const archiveNow = nowIso();
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === action.id
        ? { ...c, archivedAt: archiveNow, updatedAt: archiveNow } // ⚠️ Always updates!
        : c
    ),
  };
}
```

**Fix Required:**
```typescript
case "ARCHIVE_CARD": {
  const card = state.cards.find((c) => c.id === action.id);
  if (!card) return state;

  // Idempotency: if already archived, return unchanged state
  if (card.archivedAt) return state;

  const archiveNow = nowIso();
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.id === action.id
        ? { ...c, archivedAt: archiveNow, updatedAt: archiveNow }
        : c
    ),
  };
}
```

**Impact:**
- Medium severity - functional bug that affects data integrity
- User clicks "Archive" twice → timestamp changes unexpectedly
- Undo/Redo history could become confusing
- Metrics tracking archive time would be inaccurate

## Design Doc Requirements Coverage

From `design.md` - all specified edge cases are now tested:

| Requirement | Test Coverage | Status |
|------------|---------------|---------|
| Year boundary handling | ✅ Test #7 | PASS |
| Double-archive (idempotency) | ✅ Test #2 | **FAIL (bug found)** |
| No completedAt field | ✅ Test #8 | PASS |
| Invalid IDs | ✅ Tests #1, #4 | PASS |
| All actions undoable | ✅ Tests #3, #6, #10 | PASS |

## Existing Tests (state.test.ts)

The main test file already has 15 passing tests for basic functionality:

### ARCHIVE_CARD (4 tests)
- Sets archivedAt on the card
- Preserves existing card fields
- Updates updatedAt timestamp
- Is undoable

### UNARCHIVE_CARD (5 tests)
- Clears archivedAt and moves card to target column
- Clears completedAt when restoring to non-terminal column
- Places card at order 0 (top of column)
- Adds columnHistory entry with from: null
- Returns unchanged state for invalid target column

### AUTO_ARCHIVE_CARDS (6 tests)
- Archives cards completed in previous months
- Does not archive cards completed this month
- Skips already archived cards
- Respects autoArchive setting when disabled
- Does not archive cards in non-terminal columns
- Returns same state reference when nothing to archive

**Total Test Count:** 29 tests (15 existing + 14 new edge cases)

## Next Steps for Implementation Team

1. **Fix idempotency bug** in ARCHIVE_CARD reducer (add early return if already archived)
2. **Run full test suite** to verify fix: `npm test -- state-archive-edge-cases.test.ts`
3. **Verify all 14 tests pass** (should be 14/14 after fix)
4. **Continue with UI implementation** (ArchivePanel, buttons, badges)
5. **Integration tests** for auto-archive on app load with toast

## Test Quality Notes

✅ **Clear test descriptions** - Each test name describes expected behavior
✅ **Isolated tests** - Each test creates fresh state via `beforeEach`
✅ **Edge cases covered** - Year boundaries, invalid IDs, missing fields
✅ **Real-world scenarios** - Bulk operations, undo/redo chains
✅ **Proper assertions** - Using specific matchers (toBeDefined, toBeUndefined, toBe)
✅ **TDD approach** - Tests written before implementation fixes

## Commit Information

**Commit Hash:** `4edab95`
**Message:** `test: add failing edge case tests for card-archive-system`
**Files Changed:** 1 file, 545 lines added

## Test Execution

```bash
# Run edge case tests only
npm test -- state-archive-edge-cases.test.ts

# Run all archive tests (29 total)
npm test -- state.test.ts state-archive-edge-cases.test.ts

# Run full test suite
npm test
```

## Conclusion

The TDD approach successfully identified a real idempotency bug in the ARCHIVE_CARD implementation before the feature was marked complete. All other edge cases pass, demonstrating robust implementation of the core archive logic. The failing test provides clear guidance for the required fix.

**Test Agent Sign-off:** ✅ Ready for bug fix and continued implementation
