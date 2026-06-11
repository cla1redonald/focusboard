# Phase 5 — Agent-Native Workflows (plan, 2026-06-10)

**Status:** ARCHITECTURE-REVIEWED (rev 2 — incorporates all blocker/should-fix findings)
**Supersedes:** the one-line Phase 5 entries in `2026-06-09-cli-mcp-operating-layer{,-v2}.md`
**Context:** Phases 0–4b shipped and runtime-verified. The cards table is the system of
record (per-card version CAS, 409 STALE_STATE), focus_sessions is append-only truth,
the smoke account owns verification, realtime works (and is no longer trusted blindly).

## Why the original Phase 5 list is stale

The original six workflows were written before Phases 2–4 existed:

| Original workflow | Status today |
|---|---|
| "What should I focus on next?" | **Shipped** — `fb today` / `focusboard_today` (Phase 2) |
| "Show stale WIP" | **Shipped** — `GET /api/today` → `attention.stale` |
| "Capture these meeting actions" | Missing — needs **batch capture** (not server-side AI) |
| "Prepare my daily shutdown" | Missing — semantics exist in `src/app/review.ts`, unexposed |
| "Summarise focus history this week" | Missing — table exists, only `/focus/status` reads it |
| "Move waiting-on items to blocked" | Missing — needs **batch mutation w/ single confirmation** |

## Design principles (corrections to "compose smaller tools")

1. **Composite READS are server-side.** A shutdown digest composed client-side is 3–4
   round trips with inconsistent reads. One endpoint, importing the web's own
   `review.ts` functions (the no-drift rule), is cheaper and correct.
2. **WRITES stay primitive — except batches get ONE confirmation.** N mutations behind
   N Tier-3 confirmation gates is unusable agent UX. A batch is planned once, confirmed
   once, executed per-card under CAS with per-card results.
3. **The agent does the language work, the server does the data work.** Meeting-notes
   splitting happens in the agent; the server takes `items[]`. No server-side AI in any
   Phase 5 path (PAT captures keep AI auto-add disabled — no surprise Anthropic spend).
4. **Every workflow lands in all three surfaces** (API route → `fb` command → MCP tool)
   through the shared CLI client, like every prior phase.

## Slice 5a — in BUILD ORDER (review finding: the focus-session loader is a dependency)

### A1. Server-side data plumbing (was under-scoped as "drop-in import" — it isn't)
New in `api/_lib/`:
- **`loadFocusSessions(userId, since)`** — reads the `focus_sessions` TABLE with the
  service key and adapts rows → the web `FocusSession` type (snake_case→camelCase,
  `timestamptz`→ISO string, nullable `card_title` defaulted). ONE adapter, consumed by
  both the history endpoint and the digests. (Table is truth; this partially discharges
  the pending "flip readers off the metrics blob" follow-up.)
- **`loadMetrics(userId)`** — service-role reader for the `metrics` blob (none exists
  in `api/` today; the only metrics reader is the browser's RLS client). The digests
  need `completedCards` + `reviewMarkers` from it.
- Digest assembly constructs a `MetricsState`-shaped argument:
  `{ ...metricsBlob, focusSessions: tableSessions }` and calls the IMPORTED
  `review.ts` functions (`.js` suffix rule; `npm run typecheck:api` gates).

### A2. Focus history
- `GET /api/focus/history?days=N` (default 7, max 90) — sessions newest-first via
  `loadFocusSessions`, plus server-computed aggregates
  `{ totalMinutes, sessionCount, byOutcome, byDay }`. Scope `focus:read`.
- CLI: `fb focus history [--days N]`. MCP: `focusboard_focus_history` (Tier 2).

### A3. Shutdown + weekly digests
- **Routes: `GET /api/review/daily` and `GET /api/review/weekly`** (separate routes —
  they return different types; named after `review.ts`, grouped, contract-stable).
- Both call the imported `buildDailyShutdownSummary` / `buildWeeklyReviewSummary` with
  rows-sourced cards/columns (`loadBoard`) + the constructed MetricsState (A1).
- **Scope decision (review finding — closes a scope-model leak):** routes are
  `board:read`, and therefore the response carries focus data as AGGREGATES ONLY
  (`{ totalMinutes, sessionCount, byOutcome }` projected from the summary's sessions) —
  never raw session rows. Raw sessions remain exclusively behind `focus:read`
  (`/api/focus/*`). A board-scoped token cannot read focus history through the digest.
- Card lists in the response use the existing `slimCard` projection + per-card
  `version` (a follow-up mutation needs no re-read).
- CLI: `fb shutdown`, `fb week`. MCP: `focusboard_shutdown`, `focusboard_week` (Tier 2).

### A4. Batch capture
- **Separate route: `POST /api/capture/batch`** (review finding: do NOT extend
  `POST /api/capture` — that route is the single INLINE_AUTH exception with hand-rolled
  webhook-body auth; the batch gets normal `enforceRouteScopes` + `capture:write` and
  no webhook entanglement). Body `{ items: [{ content, source? }] }`, 1–25 items.
- Per-item idempotency: batch `Idempotency-Key` K → item key `sha256(K + ":" + index)`
  (delimited) — a retried batch re-inserts nothing. Implementation note (found at
  build time): the unique index is PARTIAL (`where idempotency_key is not null`),
  which `ON CONFLICT` can't target through supabase-js — so it's a batched
  pre-check (`.in(itemKeys)`) + per-item insert with 23505 recovery, the same
  proven pattern as the single route, not upsert-on-conflict as rev 2 assumed.
- Rate limit: counts as `items.length` against the existing per-user 30/60s window;
  oversized batches refused up front with 429 + hint. Documented as BEST-EFFORT
  (the window count isn't reserved; a concurrent capture can race it — acceptable
  single-user, revisit with a DB-side counter if it ever matters).
- Partial failure: per-item results `{ index, ok, captureId | error }`; envelope
  `ok: true` if ≥1 landed; agents retry failed items individually.
- CLI: `fb capture -` (stdin, one item per non-empty line; `--json` per-item results).
  MCP: `focusboard_capture_actions` (Tier 1), input `{ items: string[] }`.

### 5a acceptance
- Batch capture: 5 items land from one call; the SAME batch retried inserts 0;
  per-item failure reported; oversized batch refused.
- `fb shutdown` against prod matches the web Shutdown panel for the same data
  (completions, slipped/blocked/stale, tomorrow candidates); focus block is aggregate.
- `fb focus history` aggregates match a read-only SQL spot-check of the table.
- A `board:read`-only token gets digests WITHOUT focus session rows; a token without
  `focus:read` is denied `/api/focus/history` (scope-leak regression test).
- ALL verified e2e via the smoke account (zero manual steps); CI runtime-smoke gains
  `GET /api/review/daily` (200 + shape) on the smoke token.
- ROUTE_SCOPES entries for every new route (CI-enforced); `typecheck:api` clean.

## Slice 5b — batch mutation with a single confirmation (separate PR)

Generalizes the Phase 4a single-card gate. The gate lives in the stdio MCP process
(`pendingOps` map: confirm_token → captured execute closure, single-use, 5-min TTL) —
**therefore no plan-hash binding** (review finding: the token can only ever run the
closure it was minted for; a content hash defends a threat that cannot exist here).

- **Plan call** (Tier 3): `focusboard_move_cards` `{ moves: [{ id, to }] }` (max 20).
  The tool validates board/columns/cards NOW and returns
  `{ status: "confirmation_required", confirm_token, plan: [...], expires_in: 300 }`
  with a human-readable echo of exactly what will run.
- **Confirm call**: the existing `focusboard_confirm`. **Confirm-time semantics match
  4a: each card's version is re-read FRESH inside the closure at confirm time** (review
  finding — plan-time versions would manufacture false STALE_STATEs; the gate's
  protection is freshness at execution, not staleness since planning).
- **Execution**: sequential per-card `fb_mutate_card` CAS — an EXPLICIT decision:
  N round-trips for ≤20 moves over a new batch plpgsql function (simplicity, reuses the
  audited primitive; revisit only if latency hurts). NOT transactional: per-card results
  `{ id, ok, version | error }` — partial success reported honestly; the agent re-reads
  and re-plans failures. (A board is not an invoice; all-or-nothing punishes 19 good
  moves for 1 stale one.)
- **API parity**: `POST /api/cards/batch-move` (scope `card:write`) so the CLI gets
  `fb move --batch` (stdin `id:column` pairs). The MCP tool calls this route per its
  confirmed plan.
- 5b acceptance: 3-card move lands with one confirmation; a concurrently-bumped card
  reports per-card STALE_STATE while others land; expired/reused tokens refuse;
  `fb move --batch` works headless against prod (smoke account).

## Shipped separately (non-blocking ops debt, NOT gating 5a/5b)
- `scripts/token-scopes.sh` + `npm run token:scopes` — bumps a user's non-revoked
  tokens to the current full scope set (same pattern as `smoke-account.sh`). Kills the
  "tokens minted before phase N lack scopes" foot-gun without a Settings-UI step.

## Non-goals (explicit)
- No server-side AI parsing of meeting notes.
- No hosted/multi-user MCP; stdio + PAT stays.
- No metrics-blob extraction (5a only READS it; extraction is its own phase).
- No new scopes; no new Vercel functions (all routes in the Hono app).

## Verification
Everything through the smoke account: `npm run smoke:setup` → seed cards + focus
sessions via the API → run each new command/tool against prod → read-only SQL
spot-checks. Browser pass only if a web surface changes (none planned in 5a/5b).

## Review trail
- rev 1 (draft) reviewed by architect agent 2026-06-10: 2 blockers (digest plumbing
  under-scoped: missing metrics loader + focus-row adapter), 6 should-fix (batch route
  placement, idempotency composition, plan-hash theatre, scope leak, route naming,
  confirm-time versions, rate-limit TOCTOU), 2 nits, verdict "not ready as written."
- rev 2 (this doc) incorporates all of them; build order resequenced so the
  focus-session loader lands before its consumers.
