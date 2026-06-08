# Review Rituals

## Context

Focusboard now supports Today planning, card-specific focus sessions, and tighter capture triage. The next product gap is reflection: helping Claire close the day and review the week without turning the app into another dashboard.

Obsidian was checked before implementation. The open vaults had no detailed Focusboard review ritual requirements, so this note records the requirements used for this PR.

## Product Decisions

- Board remains the default landing view because often Claire wants to see everything.
- Today should become more prominent, but not default.
- Focus session history should appear in Metrics.
- Review rituals should be short completion flows, not reporting dashboards.
- AI ranking can become automatic when keys exist in a later capture/AI slice; this PR uses deterministic selectors.

## Requirements

- Add daily shutdown selectors and panel:
  - wins
  - focus sessions today
  - slipped work
  - blocked/stale work
  - tomorrow candidates
- Add weekly review selectors and panel:
  - completed this week
  - focus sessions this week
  - blockers
  - stale backlog
  - proposed commitments
- Store lightweight completion markers in metrics.
- Add focus session history to Metrics.
- Add visible TopStrip entry points without making Today the default landing view.

## Non-Goals

- No Supabase-backed capture snooze in this PR.
- No automatic AI ranking in this PR.
- No calendar export or recurring review reminders.

## Verification

- Selector tests cover daily and weekly review summaries.
- Panel tests cover rendering and completion callbacks.
- Metrics tests cover review markers.
- Metrics UI shows focus session history when present.
