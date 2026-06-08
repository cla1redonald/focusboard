# Focus Mode Sessions

Date: 2026-06-08

## Context

Today can now recommend work and persist a small daily plan. The next gap is helping Claire actually work one card at a time. Existing Pomodoro state is generic; this slice introduces card-specific sessions without replacing the Pomodoro timer.

Obsidian was checked before this programme. The open vaults had Focusboard showcase/positioning notes but no detailed product requirements for focus sessions.

## Requirements

- Start a focus session from a Today card.
- Offer 25, 50, and 90 minute session lengths.
- Show a focused modal for one card with pause/resume/reset controls.
- End a session with one outcome: progressed, blocked, completed, or abandoned.
- Persist completed session history lightly in metrics.
- If the outcome is completed, reuse the existing terminal-column move path.
- If the outcome is blocked, collect a reason and move the card to the blocked column when available.

## Non-Goals

- No background notification permissions.
- No cross-device live timer sync.
- No deep analytics dashboard in this PR.
- No replacement of the existing Pomodoro dropdown.

## Verification

- Metrics tests cover focus session retention and persistence migration.
- Component tests cover session start, pause/resume, and outcome callbacks.
- App gates: lint, typecheck, full tests, build, PR checks.
