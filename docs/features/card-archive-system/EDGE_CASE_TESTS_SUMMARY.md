# Card Archive System - Edge Case Tests Summary

## Quick Reference

**Test File:** `src/app/state-archive-edge-cases.test.ts`
**Total Tests:** 14 edge case tests
**Status:** 13 passing, 1 failing (idempotency bug found)
**Commit:** `4edab95`

## Bug Found (Expected Failure)

### ARCHIVE_CARD Idempotency Bug

**Issue:** Archiving an already-archived card updates the `archivedAt` timestamp instead of being a no-op.

**Test:** Line 47-71 in `state-archive-edge-cases.test.ts`

**Fix:** Add early return in ARCHIVE_CARD reducer when card is already archived:

```typescript
if (card.archivedAt) return state;
```

## All Edge Cases Tested

### Invalid ID Handling
- ✅ ARCHIVE_CARD with non-existent ID → returns state unchanged
- ✅ UNARCHIVE_CARD with non-existent ID → returns state unchanged

### Idempotency
- ❌ **ARCHIVE_CARD on already-archived card → should preserve timestamp** (FAILING)
- ✅ AUTO_ARCHIVE_CARDS run twice → preserves timestamps (already archived cards skipped)

### Year Boundary
- ✅ Cards from December 2024 archived in February 2026 → correctly identified as old
- ✅ Month calculation works across year boundaries

### Month Boundary Edge Cases
- ✅ First day of current month → NOT archived
- ✅ Last day of previous month → IS archived
- ✅ Same month different year → correctly identified as different

### Missing Data Handling
- ✅ Cards without `completedAt` field → not archived (graceful handling)

### Undo/Redo
- ✅ ARCHIVE_CARD can be undone and redone
- ✅ UNARCHIVE_CARD can be undone and redone
- ✅ AUTO_ARCHIVE_CARDS can be undone and redone

### Bulk Operations
- ✅ Multiple cards archived efficiently in single AUTO_ARCHIVE_CARDS action

## Running Tests

```bash
# Run edge case tests only
npm test -- state-archive-edge-cases.test.ts

# Expected output: 13 passed, 1 failed
```

## Implementation Checklist

- [ ] Fix ARCHIVE_CARD idempotency bug
- [ ] Verify all 14 tests pass
- [ ] Continue with UI components (ArchivePanel, buttons, badges)
- [ ] Add integration tests for auto-archive on app load

## Test Design Patterns

All tests follow these patterns:
- Use `renderHook(() => useAppState())` for state access
- Use `act()` wrapper for all dispatch calls
- Use `vi.useFakeTimers()` for time-dependent tests
- Clear localStorage in `beforeEach()` for isolation
- Test both positive and negative cases

## Co-Authored

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
