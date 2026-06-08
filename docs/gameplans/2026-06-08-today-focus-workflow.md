# Gameplan: Today and Focus Workflow

**Spec:** none - working from Claire's product direction in Codex session  
**Complexity:** High  
**Estimated files:** 18-26 across the full programme; 6-10 for the first PR

## Product Aim

Focusboard already has a capable board, capture inbox, AI suggestions, metrics, timeline, archive, and Pomodoro timer. The next improvement should make the app feel less like "a board with features" and more like a daily operating system for choosing and finishing the right work.

The core loop should become:

1. Capture everything quickly.
2. Triage only what needs judgment.
3. Pick today's few commitments.
4. Work one card at a time.
5. End the day with a short review.

## PR Plan

### PR 1 - Today Workspace Foundation

Goal: add a calm first-class Today workspace without changing persistence contracts yet.

Files:

- `src/components/TodayView.tsx` - new main workspace panel.
- `src/components/TodayCard.tsx` - compact recommendation card with reason/action controls.
- `src/app/today.ts` - pure helpers for today card selection, WIP summaries, overdue/due-soon grouping, and AI-reason fallback text.
- `src/app/today.test.ts` - helper tests.
- `src/app/App.tsx` - add Today panel state and pass handlers.
- `src/components/Board.tsx` - add view toggle or Today launch area while keeping board available.
- `src/components/TopStrip.tsx` - add Today entry point and reduce top-strip overload if needed.

Steps:

1. Add pure `today.ts` selectors:
   - terminal column detection
   - due today / overdue / blocked / stale / active WIP sets
   - recommended card ranking
   - WIP pressure summary
2. Test those selectors against overdue, blocked, terminal, archived, and no-date cards.
3. Build `TodayView` using existing card data and existing handlers:
   - top commitments
   - "needs attention" rail for overdue, blocked, stale, and WIP pressure
   - capture inbox prompt
   - buttons to open card, start focus, move/archive where handlers already exist
4. Wire Today into `AppContent` and `Board` with minimal state:
   - default to board for now unless UX is clearly better as Today-first
   - expose a prominent Today button in `TopStrip`
5. Run `npm run lint`, `npm run typecheck`, `npm run test:run`, and `npm run build`.

Dependencies:

- Step 3 depends on Step 1.
- Step 4 depends on Step 3.
- Tests can be written in parallel with component work once helper signatures are stable.

Risks:

- Risk: Today view duplicates `Board` calculations.
  - Mitigation: keep selection logic in `src/app/today.ts` and reuse in UI.
- Risk: too many actions make Today as noisy as the board.
  - Mitigation: one primary action per card, secondary actions in compact controls.
- Risk: ranking feels arbitrary.
  - Mitigation: expose reason chips such as overdue, due today, blocked, stale, or WIP pressure.

### PR 2 - Focus Mode Sessions

Goal: turn the Pomodoro timer into a card-specific focus session.

Files:

- `src/app/types.ts` - add `FocusSession` and metrics fields.
- `src/app/metrics.ts` - record focus outcomes.
- `src/app/metrics.test.ts` - session metric coverage.
- `src/components/FocusMode.tsx` - full-screen or large modal focus session.
- `src/components/PomodoroTimer.tsx` - accept optional card/session props or delegate to `FocusMode`.
- `src/app/App.tsx` - session lifecycle handlers.

Steps:

1. Add a non-breaking `FocusSession` type and local metrics storage migration.
2. Implement session start for 25, 50, and 90 minutes.
3. Add outcomes: done, progressed, blocked, abandoned.
4. On done, reuse existing move-to-terminal path if available; on blocked, collect a reason.
5. Show session history in metrics only after data exists.

Dependencies:

- PR 1 supplies the best entry point for starting a focus session.

Risks:

- Risk: mutating the card on every timer tick creates noisy sync/history.
  - Mitigation: keep timer state local; persist only session start/end/outcome.
- Risk: completing a session and completing a card become confused.
  - Mitigation: name outcomes clearly and require explicit "Mark card done".

### PR 3 - Capture Triage Upgrade

Goal: make Capture Inbox a fast decision queue.

Files:

- `src/components/CaptureInbox.tsx`
- `src/app/captureTypes.ts`
- `src/app/useCaptureQueue.ts`
- `api/capture/process.ts`
- `src/components/CaptureInbox.test.tsx`

Steps:

1. Add decision actions: approve, edit, snooze, split, discard.
2. Show confidence and parser reason in plain language.
3. Add editable notes/due date/tags before adding.
4. Keep auto-added items visible but quiet.
5. Add tests for edit/add, dismiss, and snooze state transitions.

Dependencies:

- Can run after PR 1 independently of PR 2.

Risks:

- Risk: snooze needs backend schema if capture queue is cloud-backed.
  - Mitigation: check existing Supabase migration before adding UI; prefer additive nullable `snoozed_until`.

### PR 4 - Actionable WIP

Goal: replace passive WIP warnings with concrete choices.

Files:

- `src/components/WipModal.tsx`
- `src/components/Board.tsx`
- `src/app/today.ts`
- `src/app/metrics.ts`

Steps:

1. In WIP modal, show cards currently causing pressure.
2. Offer actions: finish one, move back, archive, or override with reason.
3. Record WIP overrides as metrics.
4. Surface WIP pressure in Today view.

Dependencies:

- Should follow PR 1 so Today can summarize WIP pressure.

Risks:

- Risk: archival/destructive actions inside WIP modal are too easy.
  - Mitigation: use explicit labels and keep undo toast.

### PR 5 - Review Rituals

Goal: add daily shutdown and weekly review workflows.

Files:

- `src/components/DailyShutdownPanel.tsx`
- `src/components/WeeklyReviewPanel.tsx`
- `src/app/review.ts`
- `src/app/review.test.ts`
- `src/app/metrics.ts`
- `src/app/App.tsx`
- `src/components/TopStrip.tsx`

Steps:

1. Add pure review selectors:
   - completed today
   - slipped cards
   - stale cards
   - blocked cards
   - candidates for tomorrow
2. Build Daily Shutdown panel:
   - wins
   - slipped work
   - archive suggestions
   - tomorrow's one thing
3. Build Weekly Review panel:
   - throughput
   - recurring blockers
   - stale backlog
   - proposed commitments
4. Store review completion markers in metrics/settings if needed.

Dependencies:

- Works best after PR 1 and PR 2, when Today and focus sessions produce more useful signals.

Risks:

- Risk: review becomes another dashboard.
  - Mitigation: make it a short ritual with completion, not a data dump.

## Suggested First Build Slice

Start with PR 1 only:

1. `src/app/today.ts`
2. `src/app/today.test.ts`
3. `src/components/TodayView.tsx`
4. lightweight wiring in `App.tsx`, `Board.tsx`, and `TopStrip.tsx`

This gives Claire a visible, valuable improvement quickly while keeping the data model stable.

## Verification Gates

Run before every PR:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`
- Top-level PR comment starting with `@claude review` after the PR is opened, or automatic Claude Code Review if the repository is enabled in Claude organization settings.

For UI-heavy PRs, also run the local app and inspect:

- desktop Today workspace
- mobile Today workspace
- dark mode
- empty board
- overloaded board with overdue, blocked, stale, and WIP-pressure cards

## Open Decisions

1. Should Today become the default landing surface, or should it be a prominent mode alongside Board for the first PR?
2. Should focus session history live in `MetricsState`, or should it have separate storage to avoid overloading metrics?
3. Should capture snooze be local-only first, or go straight into Supabase-backed queue schema?
4. Should AI ranking be optional, with deterministic ranking as default, or should it be called automatically when API keys exist?
