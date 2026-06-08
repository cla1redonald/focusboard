# Actionable WIP

## Context

Today and Focus Mode make it easier to pick and work one card at a time. The next gap is WIP pressure: the board already warns when a column is full, but the warning is passive.

Obsidian was checked before implementation. The open vaults had no detailed Focusboard WIP requirements, so this note records the requirements used for this PR.

## Requirements

- WIP limit warnings should show the cards already causing pressure.
- The warning should offer concrete choices: open a card, move a card back, archive a card, or override with a reason.
- Override reasons should be recorded in metrics for later review.
- Today should surface WIP pressure with enough context to act, not just a count.
- Archive actions must remain undoable and explicit.

## Non-Goals

- No destructive delete action inside the WIP modal.
- No automatic choice of which card to move or archive.
- No settings redesign for WIP limits.

## Verification

- Metrics tests cover structured WIP override recording.
- Component tests cover pressure-card actions and required override reasons.
- Existing Board and Today coverage protects the surrounding UI.
