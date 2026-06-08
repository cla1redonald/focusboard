# Daily Plan Controls

Date: 2026-06-08

## Context

Focusboard was Claire's first proper AI-coded app, so feature work should also tighten product requirements and implementation seams as they surface. The Today workspace foundation exists; this slice turns it from recommendations into a small daily command center.

Obsidian was checked before implementation. The open vaults had Focusboard showcase/positioning notes, but no detailed product requirements for daily planning. This note records the requirements used for this PR.

## Requirements

- Today should support one main focus for the current local day.
- Today should support a short list of support tasks for the current local day.
- The daily plan should persist with the board state so refreshes do not erase the plan.
- A stale plan from a previous local day should not appear as today's plan.
- Archived or missing cards should not render as active plan items.
- Planned progress should come from existing terminal-column state, not a new completion model.
- Existing recommendation ranking should remain deterministic and continue working without AI calls.

## Non-Goals

- No focus-session timer persistence in this PR.
- No metrics schema changes in this PR.
- No Supabase schema changes in this PR.
- No automatic AI ranking in this PR.

## Implementation Notes

- `DailyPlan` is an additive optional field on `AppState`.
- `buildTodayDailyPlan` resolves the persisted plan against current cards/columns and filters stale or unavailable cards.
- `TodayView` owns presentation only; `AppContent` owns reducer actions and toasts.
- The local day key uses the existing Today helper so due-date and plan-date behavior stay aligned.

## Verification

- Selector tests cover local date keys, stale plan hiding, missing/archived card filtering, and terminal-column progress.
- Storage tests cover loading a saved V4 daily plan.
- Component tests cover setting main focus, toggling support tasks, clearing a plan, and planned progress display.
