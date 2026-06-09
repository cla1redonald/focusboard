# Focusboard CLI and MCP Operating Layer Plan

Date: 2026-06-09

## Goal

Make Focusboard usable as a daily operating tool from the command line and from AI agents, similar to how Todoist works with a CLI and MCP, without weakening Focusboard's data model or turning external tools into direct database writers.

Focusboard should not become a Todoist clone. The product centre should stay:

> Help Claire capture work, choose what deserves attention, protect focus, and close loops.

## Context

Focusboard already has:

- A Vercel-hosted web app.
- Supabase-backed state, metrics, auth, storage, and capture queue.
- A webhook/capture API.
- AI parsing for raw captures.
- Capture snooze.
- Focus sessions and focus history.
- Today planning, metrics, review rituals, archive, timeline, and WIP support.

The gap is an operator interface:

- A fast local CLI for capture and focus workflows.
- An MCP server so Codex, Claude, and other agents can read and act through Focusboard safely.
- A stable API boundary so the web app, CLI, and MCP use the same rules.

Obsidian was checked before this recommendation. The useful matching pattern is Claire's existing low-friction capture and CLI/MCP operating style, not a detailed Focusboard product spec.

## Product Principles

- Capture must be lower friction than opening the app.
- CLI and MCP should call Focusboard APIs, not write directly to Supabase.
- One place should own validation, auth, side effects, and state versioning.
- External tools should start with capture and read-only board access before direct board mutation.
- AI should help triage and rank when keys exist, but commands must still work without AI.
- The web app should reflect external changes cleanly through the existing sync/realtime paths.
- Data loss prevention matters more than clever commands.

## Recommended Architecture

```text
CLI / MCP / Shortcuts / Webhooks
        |
        v
Focusboard API
        |
        v
Application rules + validation
        |
        v
Supabase + realtime sync
        |
        v
Web app
```

Do not let the CLI or MCP write directly to Supabase. Direct writes would duplicate business logic, bypass validation, and make board-state corruption easier.

## Surfaces

### Focusboard API

The API should expose a small set of authenticated operations:

- Capture raw input.
- List capture inbox items.
- Snooze, dismiss, or delete a capture.
- Read board/cards.
- Read Today view.
- Search cards.
- Start and stop focus sessions.
- Complete or move cards once safe mutation support exists.

### Focusboard CLI

Possible command name: `fb`.

Initial command shape:

```bash
fb capture "Follow up with ENSEK about next steps"
fb inbox
fb today
fb focus start
fb focus stop
```

Later commands:

```bash
fb add "Draft proposal" --today --tag roami
fb list --status doing
fb search "invoice"
fb move card_123 done
fb done card_123
fb snooze capture_123 --until tomorrow
fb review today
```

### Focusboard MCP

Initial tool shape:

- `focusboard_capture`
- `focusboard_get_today`
- `focusboard_list_capture_inbox`
- `focusboard_snooze_capture`
- `focusboard_start_focus_session`
- `focusboard_complete_focus_session`

Later tools:

- `focusboard_search_cards`
- `focusboard_get_wip`
- `focusboard_move_card`
- `focusboard_complete_card`
- `focusboard_get_metrics_summary`
- `focusboard_daily_shutdown`

## Phased Plan

### Phase 1: Capture First

Use the existing `capture_queue` as the safe entry point.

Build:

- API hardening for capture/inbox operations.
- CLI commands:
  - `fb capture`
  - `fb inbox`
  - `fb snooze`
- MCP tools:
  - `focusboard_capture`
  - `focusboard_list_capture_inbox`
  - `focusboard_snooze_capture`

Why first:

- The capture queue is already Supabase-backed and structured.
- It avoids risky board-state mutation.
- It immediately creates a Todoist-like daily habit loop.

### Phase 2: Read-Only Board Access

Build:

- API endpoints for board/card reads.
- CLI commands:
  - `fb today`
  - `fb list`
  - `fb search`
  - `fb wip`
- MCP tools:
  - `focusboard_get_today`
  - `focusboard_list_cards`
  - `focusboard_search_cards`

Why second:

- Agents can reason over the board without changing it.
- Claire can query Focusboard from terminal and assistant sessions.
- It exposes data-model gaps before mutation commands rely on them.

### Phase 3: Focus Sessions

Build:

- API endpoints for starting and ending focus sessions.
- CLI commands:
  - `fb focus start`
  - `fb focus stop`
  - `fb focus status`
- MCP tools:
  - `focusboard_start_focus_session`
  - `focusboard_complete_focus_session`

Why third:

- This turns Focusboard into an attention tool, not just a task list.
- It uses the session history work already shipped.

### Phase 4: Controlled Card Mutation

Build only after API/state safety is proven:

- Create a card directly.
- Move a card.
- Complete a card.
- Add tags.
- Mark blocked.

Required protections:

- Schema validation.
- Auth scoped to the current user.
- State versioning or optimistic locking.
- Tests for concurrent web-app and CLI updates.
- Clear failure messages when state changed underneath the command.

### Phase 5: Agent-Native Workflows

Once the primitives are safe, add higher-order workflows:

- "Capture these meeting actions."
- "Show stale WIP."
- "What should I focus on next?"
- "Prepare my daily shutdown."
- "Summarise focus history this week."
- "Move waiting-on-someone items to blocked."

These should compose smaller tools rather than becoming one large opaque agent action.

## First Build Slice

Recommended first implementation slice:

- `fb capture "raw thought"`
- `fb inbox`
- `fb snooze <capture-id> --minutes 60`
- `focusboard_capture`
- `focusboard_list_capture_inbox`
- `focusboard_snooze_capture`

This should be a `/shipit`-sized feature, not a full `/orchestrate` programme.

Acceptance criteria:

- CLI can capture a raw item into production Focusboard.
- Web app Capture Inbox shows the captured item.
- MCP tool can create the same kind of capture.
- Snoozed captures hide until due and remain persisted in Supabase.
- No direct Supabase writes from CLI or MCP.
- Auth secrets are stored locally outside git.
- CI passes.
- Production deploy is smoke-tested.

## Risks and Design Questions

- Board state may still be too blob-like for safe external mutation.
- CLI auth needs a simple but safe local setup.
- MCP tools need clear permission boundaries; agents should not be able to destructively mutate cards by accident.
- Card IDs and capture IDs need user-friendly display in CLI output.
- Need to decide whether the CLI package lives inside this repo or as a separate package later.
- Need to decide whether the MCP server is local-only first or hosted later.

## Recommendation

Start with Phase 1. It gives immediate value, exercises the architecture, and avoids the riskiest state mutations.

Once capture/inbox/snooze works well from CLI and MCP, move to read-only board access, then focus sessions, then controlled card mutation.
