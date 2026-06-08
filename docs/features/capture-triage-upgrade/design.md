# Capture Triage Upgrade

Date: 2026-06-08

## Context

Capture Inbox already lists ready, processing, and auto-added items. As a first AI-coded app, Focusboard benefits from tightening the workflow rather than assuming captured data is perfect.

Obsidian was checked before this programme. The open vaults had Focusboard showcase/positioning notes but no detailed product requirements for capture triage.

## Requirements

- Keep triage fast: approve, edit, snooze, or discard.
- Let users edit title, column, swimlane, due date, tags, and notes before adding.
- Show confidence and parsing context in plain language.
- Snooze should be local-only in this PR to avoid a Supabase schema change.
- Discard should be visibly different from "dismiss" so the action is understandable.
- Existing ready/processing/auto-added sections should keep working.

## Non-Goals

- No Supabase schema migration in this PR.
- Supabase-backed snooze persistence was added later in PR #13; see `docs/features/supabase-capture-snooze/design.md`.
- No server-side snooze scheduling.
- No multi-card splitting in this PR unless the parsed payload already contains multiple cards.

## Verification

- Component tests cover edit/add with notes, snooze hiding, discard, and existing approve behavior.
- App gates: lint, typecheck, full tests, build, PR checks.
