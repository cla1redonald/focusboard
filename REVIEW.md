# Focusboard Review Guidance

Prioritize findings that could break real user workflows, corrupt or lose board data, weaken auth/storage boundaries, or make Focusboard less useful as a daily work system.

## What to Flag

- State reducer bugs, stale references, broken undo/redo behavior, or missed call sites after type changes.
- Persistence and sync regressions across localStorage, Supabase, metrics, archive, capture queue, and user-scoped data.
- UI states that overlap, trap focus, fail on mobile, ignore dark mode, or make the primary daily workflow harder to understand.
- New API routes without input validation, CORS/auth checks, useful error responses, or targeted tests.
- AI/capture behavior that hides uncertainty, silently drops fields, or auto-adds low-confidence tasks without a review path.
- WIP, focus session, and review ritual changes that record misleading metrics or mutate cards too aggressively.

## What to Skip

- Pure formatting preferences already covered by lint/prettier-style conventions.
- Comments on generated output, coverage reports, `dist`, screenshots, or build artifacts.
- Broad architecture rewrites unless the PR introduces a concrete regression.

## Test Expectations

For meaningful app changes, expect:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`

For UI-heavy changes, also verify desktop, mobile, dark mode, empty-state, and overloaded-board states.
