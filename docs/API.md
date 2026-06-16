# Focusboard API

Focusboard exposes a single HTTP API for capturing tasks from any channel, reading the board, mutating cards, running focus sessions, and driving everything from the CLI / a hosted MCP server. Almost every route lives in one Hono router (`api/index.ts` → `api/_lib/hono-app.ts`); a few signature-sensitive endpoints (Slack, the legacy webhook, the internal capture processor, feedback) are standalone Vercel functions.

## Base URL

```
https://focusboard-claire-donalds-projects.vercel.app
```

The `-claire-donalds-projects` segment is the Vercel team slug — preview and prod deploys both live under `focusboard[-<hash>]-claire-donalds-projects.vercel.app`, and CORS trusts only that suffix (plus `focusboard.vercel.app`, `focusboard-alpha.vercel.app`, and localhost).

---

## Authentication

Auth is enforced app-wide by `enforceRouteScopes` (registered with `app.use("*")`) against the `ROUTE_SCOPES` table — the single source of truth for API policy. A matched route with **no** table entry is **denied** (deny-by-default, fails closed). A test asserts every registered route has an entry, so a missing policy fails CI before it fails a request.

### Principal kinds

`authenticate()` resolves the request's `Authorization` header into one principal, in strict priority order:

| Priority | Kind | Credential | Scopes |
|----------|------|------------|--------|
| 1 | `pat` | `Authorization: Bearer fb_pat_...` (Personal Access Token) | the scopes stored on the token |
| 2 | `oauth` | `Authorization: Bearer fb_oat_...` (OAuth access token) | the token's granted scopes (refresh token is `fb_ort_...`) |
| 3 | `webhook` | shared secret in the JSON body `secret` field (not a header) | `capture:read`, `capture:write` |
| 4 | `session` | `Authorization: Bearer <supabase access JWT>` | `ALL` (a signed-in web session holds every scope) |

Notes:

- A token whose prefix is recognised (`fb_pat_` / `fb_oat_`) but whose lookup fails (revoked / expired) returns 401 and does **not** fall through to session auth.
- Only PATs persist `last_used_at`. Tokens are stored as SHA-256 hashes; the plaintext is shown once at creation and never recoverable.
- The webhook secret is verified with a constant-time compare against `WEBHOOK_SECRET`, and the principal's `userId` is `FOCUSBOARD_USER_ID`.

### Scope vocabulary

| Scope | Grants |
|-------|--------|
| `capture:read` | read the capture inbox, `GET /api/me`, enter `POST /api/mcp` |
| `capture:write` | create / snooze / dismiss / batch captures |
| `board:read` | `today`, `cards`, `wip`, `review/*` |
| `focus:read` | focus status + history |
| `focus:write` | start / stop focus sessions |
| `card:write` | create / patch / move / done / batch-move cards; confirmations |

### Route classes

Beyond a plain scope string, a `ROUTE_SCOPES` entry can be:

- **`SESSION_ONLY`** — only a `session` principal passes (PATs must not manage PATs). Used by all `/api/tokens` routes; non-session principals get `403 SESSION_REQUIRED`.
- **`INLINE_AUTH`** — the handler authenticates itself because it must read the request body first. The **only** such route is `POST /api/capture` (webhook auth reads the body's `secret`, which middleware must not consume).
- **`PUBLIC`** — no auth. Used by `GET /api/health/deep`, the OAuth endpoints, the well-known discovery docs, the `GET`/`DELETE /api/mcp` 405 stubs, and the `PUT`/`PATCH`/`HEAD /api/capture` 405 stubs.

---

## Response envelope

Every Hono route returns the same envelope (`api/_lib/envelope.ts`):

```jsonc
// success
{ "ok": true, "data": { /* route-specific */ } }

// failure
{ "ok": false, "error": { "code": "VALIDATION", "message": "...", "hint": "optional" } }
```

Error codes are **stable** — clients and agents branch on `error.code`. New codes may be added; existing ones are never renamed.

| `code` | HTTP | Meaning |
|--------|------|---------|
| `VALIDATION` | 400 | Bad input |
| `NOT_AUTHENTICATED` | 401 | No / invalid credentials |
| `INSUFFICIENT_SCOPE` | 403 | Principal lacks the route's scope |
| `SESSION_REQUIRED` | 403 | A non-session principal hit a `SESSION_ONLY` route |
| `FORBIDDEN` | 403 | Fail-closed (route missing from the scope table) |
| `NOT_FOUND` | 404 | Card / token / board / capture not found |
| `METHOD_NOT_ALLOWED` | 405 | Unsupported method on a route |
| `STALE_STATE` | 409 | Optimistic-concurrency conflict (re-read and retry) |
| `ALREADY_ACTIVE` | 409 | A focus session is already running |
| `RATE_LIMITED` | 429 | Per-user capture rate limit exceeded |
| `CONFIRM_NOT_FOUND` | 404 | Confirmation token expired / used / not yours |
| `INTERNAL` | 500 | Unexpected server error |

**Envelope-exempt:** the OAuth endpoints (`/api/oauth/*`) and the `/.well-known/*` discovery docs return **raw RFC-shaped JSON** (RFC 6749 / RFC 7591), not the `{ ok, ... }` envelope. The standalone functions (Slack, `webhook/add-card`, `capture/process`, `feedback/submit`) predate the envelope and return their own ad-hoc `{ success | error }` shapes (documented per-route below).

---

## Routes

Scopes shown are the `ROUTE_SCOPES` policy. All paths are prefixed `/api`.

### System

#### `GET /api/health/deep` · `PUBLIC`

Multi-segment liveness probe (deliberately two path segments — a routing regression on multi-segment paths fails the deploy gate here). Returns `{ ok: true, data: { deep: true } }`.

#### `GET /api/me` · `capture:read`

Identity / token-validation check for `fb auth status` and login.

```json
{ "ok": true, "data": { "userId": "...", "kind": "pat", "scopes": ["capture:read", "..."] } }
```

`scopes` is `["*"]` for a session principal.

---

### Board reads · `board:read`

These import the web app's own `today.ts` / `filters.ts` / `review.ts` so the API can't drift from the web. All 404 (`NOT_FOUND`, with a hint to open the web app once) if the user has no board.

#### `GET /api/today`

The day plan: `date`, `activeCount`, `dailyPlan` (`main`, `support[]`, `completedCount`, `plannedCount`), `recommendations[]` (`card`, `reasons[]`, `score`), `attention` (`overdue`/`dueToday`/`blocked`/`stale` card arrays), and `wipPressure[]`.

#### `GET /api/cards`

Active cards (terminal-column cards excluded), filtered with the web's matcher.

| Query | Default | Notes |
|-------|---------|-------|
| `column` | — | Must be a valid column id (else `400 VALIDATION` listing valid ids) |
| `q` | — | Search string |
| `swimlane` | — | Exact match against `work` / `personal` |
| `limit` | 100 | Clamped to 1–200 |

Returns `{ total, items: [{ ...slimCard, version }], columns: [{ id, title, wipLimit, isTerminal }] }`.

#### `GET /api/cards/:id`

A single card (including archived ones): `{ card: { ...slimCard, archived, version } }`. `404 NOT_FOUND` if absent.

#### `GET /api/wip`

Per-column WIP counts: `{ columns: [{ id, title, count, limit, atLimit, isTerminal }], activeCount }`.

---

### Card mutation · `card:write`

External writes go through the `fb_add_card` / `fb_mutate_card` Postgres functions: one transaction, the `app_state` row locked, a per-card **version** compare-and-swap against the cards mirror. The blob update fires the existing realtime path, so an open web tab reflects the change live.

**Optimistic-concurrency contract.** `PATCH /api/cards/:id`, `POST /api/cards/:id/move`, and `POST /api/cards/:id/done` **require** a `version` field in the body:

- Pass the integer `version` you last read (from `GET /api/cards/:id` or `GET /api/cards`) → CAS check.
- Pass `version: null` to deliberately skip the conflict check.
- **Omit `version` entirely → `400 VALIDATION`** (forcing callers to take a position prevents silent clobbers).

A stale version → **`409 STALE_STATE`**: re-read the card and retry with the fresh `version`.

#### `POST /api/cards`

Create a card. `version` is not used (the card is new).

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | trimmed, ≤300 chars |
| `column` | no | default `backlog`; must be a valid column id |
| `swimlane` | no | `work` (default) or `personal` |
| `tags` | no | array of tag **names** (resolved to ids; unknown name → `400`) |
| `dueDate` | no | ISO date `YYYY-MM-DD` |
| `notes` | no | ≤5000 chars |

> The `notes` cap (`NOTES_MAX_LENGTH = 5000`, `api/_lib/constants.ts`) is enforced identically on write **and** on read serialization (`slimCard`). These previously disagreed — reads truncated at 280 — silently dropping notes of 281–5000 chars on round-trip ([#55](https://github.com/cla1redonald/focusboard/issues/55)).

`201` with `{ card: { ...slimCard, version: 1 } }`.

#### `PATCH /api/cards/:id`

Partial update. Body: `version` (required) plus any of `title`, `notes` (string|null), `dueDate` (ISO|null), `blockedReason` (string|null), `tags` (array of names). Empty patch → `400 VALIDATION`. Returns `{ card: { ...slimCard, version } }`.

#### `POST /api/cards/:id/move`

Body: `version` (required), `column` (required, valid id). Moving into a terminal column stamps `completedAt`. Returns the updated card.

#### `POST /api/cards/:id/done`

Body: `version` (required). Moves the card to the first terminal column and stamps `completedAt`. `400` if the board has no terminal column.

#### `POST /api/cards/batch-move`

Body: `{ moves: [{ id, to }] }`, 1–20 moves, no duplicate ids. The whole plan is validated up front (unknown column → `400`, unknown card → `404`). Execution is **sequential per-card CAS** and **deliberately not transactional** — partial success is reported honestly. Versions are read at execution time.

```json
{ "ok": true, "data": {
  "total": 3, "moved": 2,
  "results": [
    { "id": "...", "title": "...", "to": "doing", "ok": true, "version": 4 },
    { "id": "...", "title": "...", "to": "done", "ok": false, "error": "STALE_STATE" }
  ]
}}
```

Per-result `error` is one of `STALE_STATE`, `NOT_FOUND`, `INTERNAL`.

---

### Capture

#### `GET /api/capture` · `capture:read`

The triage inbox: up to 50 capture rows in `TRIAGE_STATUSES`, excluding snoozed-in-the-future items. Returns `{ items: [...], total }`.

`PUT /api/capture`, `PATCH /api/capture`, and `HEAD /api/capture` are `PUBLIC` stubs returning `405 METHOD_NOT_ALLOWED` — non-POST methods are accepted by the router but rejected as method guards (POST is the only real verb here).

#### `POST /api/capture` · `INLINE_AUTH`

Capture raw content. The handler authenticates itself (priority: **PAT > webhook secret > session**) because the webhook path reads `secret` from the body.

| Field | Required | Notes |
|-------|----------|-------|
| `content` | yes | trimmed, truncated to 10,000 chars |
| `source` | no | one of `email`, `slack`, `shortcut`, `browser`, `whatsapp`, `in_app` (default; invalid → `in_app`) |
| `metadata` | no | object; dropped if its JSON serializes over 5 KB |
| `secret` | conditional | webhook secret — only when not using a Bearer token |

There is **no `user_id` body field** — the user is derived from the principal. The legacy `action` field is **rejected** (`400 VALIDATION`, pointing at the dedicated snooze/dismiss routes).

PAT-authenticated captures additionally get:

- **Per-user rate limit:** 30 captures / 60 s rolling window → `429 RATE_LIMITED`.
- **Idempotency:** send an `Idempotency-Key` header; a repeat returns the original `{ captureId, duplicate: true }` instead of inserting again.

Success: `{ captureId, source }` (or `{ captureId, duplicate: true }`). After insert, the handler fires `POST /api/capture/process` via `waitUntil` with `internal_secret` and `auto_add` — **`auto_add` is `false` for PAT captures** (they always land in the inbox for review) and `true` for session/webhook captures.

#### `POST /api/capture/:id/snooze` · `capture:write`

Body: `{ minutes }` (default 60, clamped 1–43200). Sets `snoozed_until`. `404 NOT_FOUND` if the capture isn't the principal's. Returns `{ captureId, snoozedUntil }`.

#### `POST /api/capture/:id/dismiss` · `capture:write`

Sets the capture's status to `dismissed`. Returns `{ captureId }`.

#### `POST /api/capture/batch` · `capture:write`

Bulk-insert pre-split items: `{ items: [{ content, source? }] }`, 1–25 items. The agent does the language work (splitting notes); the server just stores ready items — **no AI processing is triggered**. The batch counts as `items.length` against the same 30/60 s per-user window (`429` if it would exceed). With an `Idempotency-Key` header, per-item keys are derived as `sha256(key:index)`. Returns `201` `{ total, captured, results: [{ index, ok, captureId?, duplicate?, error? }] }`.

#### `POST /api/capture/process` (standalone function — internal)

The AI extraction pipeline, fired automatically by `POST /api/capture`. **Not** a Hono route and **not** behind `ROUTE_SCOPES` — it authenticates with a shared `internal_secret` (constant-time compared against `CAPTURE_INTERNAL_SECRET`).

| Field | Required | Notes |
|-------|----------|-------|
| `capture_id` | yes | row to process |
| `user_id` | yes | owner (verified against the row; mismatch → `403`) |
| `internal_secret` | yes | shared secret; wrong/missing → `401` |
| `auto_add` | no | default `true`; when `false` the result never becomes `auto_added` (always `ready` for review) |

Pipeline: marks the row `processing`, sends content + board context to Claude Haiku (`claude-3-5-haiku-20241022`) for structured extraction, averages per-card confidence, and — only when `auto_add !== false` and avg ≥ **0.8** — sets `auto_added` and writes cards via `fb_add_card`; otherwise `ready`. Status writes are guarded to `pending`/`processing` rows so a dismissed capture is never resurrected. Returns ad-hoc `{ success, status, confidence, cardCount }`.

---

### Focus sessions

Append-only rows in `focus_sessions` (never blob mutation). One active session per user is enforced by a partial unique index, so a concurrent double-start loses at the database.

#### `GET /api/focus/status` · `focus:read`

The active session (or `null`) plus today's closed-session summary: `{ active, today: { sessions, focusedMinutes } }`.

#### `GET /api/focus/history` · `focus:read`

Query `days` (default 7, clamped 1–90). Returns the aggregate, a `byDay` map, and the raw `sessions[]`.

#### `POST /api/focus/start` · `focus:write`

Body: `{ cardId?, plannedMinutes? }` (`plannedMinutes` clamped 1–480, default 25). A supplied `cardId` is validated against the board (`404` if absent) and its title denormalised. `source` is `cli` for PATs, else `web`. A second concurrent start → **`409 ALREADY_ACTIVE`**. Returns `{ id, cardId, cardTitle, plannedMinutes, startedAt }`.

#### `POST /api/focus/stop` · `focus:write`

Body: `{ outcome?, note? }`. `outcome` ∈ `progressed` (default), `blocked`, `completed`, `abandoned` (invalid → `400`). `note` ≤1000 chars. `404 NOT_FOUND` if no session is active. Returns the closed session including computed `actualMinutes`.

---

### Reviews · `board:read`

Composite digests built from the web's own `review.ts`. Focus data is exposed as **aggregates only** — raw session rows stay behind `focus:read`.

#### `GET /api/review/daily`

Daily shutdown summary: `date`, `isComplete`, `completedToday`, `focus` (aggregate), and card arrays `slipped`, `blocked`, `stale`, `tomorrowCandidates`.

#### `GET /api/review/weekly`

Weekly review: `weekKey`, `isComplete`, `completedThisWeek`, `focus` (aggregate), and card arrays `blocked`, `staleBacklog`, `proposedCommitments`.

---

### Tokens · `SESSION_ONLY`

PAT management. Non-session principals get `403 SESSION_REQUIRED` — a PAT cannot mint or revoke PATs.

#### `GET /api/tokens`

List the principal's tokens (id, name, scopes, `last_used_at`, `created_at`, `revoked_at`).

#### `POST /api/tokens`

Body: `{ name, scopes? }`. `name` required, ≤100 chars. `scopes` defaults to all six (`capture:read`, `capture:write`, `board:read`, `focus:read`, `focus:write`, `card:write`); any unknown scope → `400`. Returns `201` `{ token, id, name }` — the plaintext `token` is shown **once**.

#### `DELETE /api/tokens/:id`

Soft-revoke (sets `revoked_at`). `404 NOT_FOUND` if not found / already revoked.

---

### Confirmations · `card:write`

Durable Tier-3 confirmation gate for the hosted MCP server (replaces the old in-memory map). Both routes require `card:write` — every gated tool mutates cards.

#### `POST /api/confirmations`

Body: `{ tool, args, preview }`. `tool` must be in the allowlist (`add_card`, `move_card`, `done_card`, `update_card`, `move_cards`); `preview` ≤2000 chars; `args` an object. Mints a single-use token (5-minute TTL; only its hash is stored). Returns `201` `{ confirm_token, expires_in_seconds, preview }`.

#### `POST /api/confirmations/confirm`

Body: `{ confirm_token }`. Atomically claims the token (single-use, unexpired, same `user_id`) and executes the mapped operation in-process via the Hono app — the caller's own `Authorization` rides along, so `card:write` is re-enforced on the executed route, and the fresh card version is read at confirm time (preserving the CAS contract). A bad/expired/used token → **`404 CONFIRM_NOT_FOUND`**. The executed route's own errors (e.g. `409 STALE_STATE`) propagate.

---

### OAuth 2.1 (single-principal) — envelope-exempt, all `PUBLIC`

RFC-shaped JSON, not the `{ ok }` envelope. The flow authenticates via Supabase password (server-side `signInWithPassword`), not Bearer tokens. Supported scopes match the six PAT scopes; PKCE `S256` only.

| Route | Purpose |
|-------|---------|
| `POST /api/oauth/register` | Dynamic Client Registration (RFC 7591). Body `{ redirect_uris[], client_name? }` (https or `http://localhost` only). Returns RFC 7591 client metadata. |
| `GET /api/oauth/authorize` | Renders the sign-in HTML form. Query: `response_type=code`, `client_id`, `redirect_uri`, `state?`, `code_challenge`, `code_challenge_method=S256`, `scope?`. Bad client/redirect → 400 text; other errors → redirect with `?error=`. |
| `POST /api/oauth/authorize` | Processes the form (`application/x-www-form-urlencoded`). Per-IP throttle (15 attempts / 10 min → `429`). On success → `302` to `redirect_uri?code=...&state=...`. |
| `POST /api/oauth/token` | Exchanges `authorization_code` (with PKCE verifier) or rotates a `refresh_token`. Accepts form or JSON. Returns RFC 6749 token response (`fb_oat_` access + `fb_ort_` refresh, `expires_in: 3600`). |

#### Discovery (well-known) — envelope-exempt, `PUBLIC`

Served by a separate Hono app mounted before the `/api` base path; the `vercel.json` rewrite routes `/.well-known/(.*)` → `/api`.

- `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata (issuer, endpoints, `code_challenge_methods_supported: ["S256"]`, `scopes_supported`).
- `GET /.well-known/oauth-protected-resource` (and `/.../*`) — `{ resource: ".../api/mcp", authorization_servers: [...] }`.

---

### Hosted MCP

#### `POST /api/mcp` · `capture:read`

Stateless JSON-RPC MCP endpoint. `capture:read` is only the bar to *enter*; per-tool scope is enforced during in-process dispatch (`ROUTE_SCOPES` re-fires on each sub-request). `GET /api/mcp` and `DELETE /api/mcp` return `405 METHOD_NOT_ALLOWED` — both are `PUBLIC` method guards; MCP uses POST only (connectors probe with them).

The server exposes **19 `focusboard_*` tools** that map onto the routes above:

```
focusboard_capture            focusboard_capture_actions    focusboard_inbox
focusboard_snooze_capture     focusboard_today              focusboard_cards
focusboard_wip                focusboard_focus_history      focusboard_shutdown
focusboard_week               focusboard_focus_status       focusboard_start_focus_session
focusboard_stop_focus_session focusboard_add_card           focusboard_move_card
focusboard_complete_card      focusboard_update_card        focusboard_move_cards
focusboard_confirm
```

---

## Standalone functions (legacy, ad-hoc responses)

Vercel matches literal function files **before** the `/api/(.*)` rewrite, so these keep working unchanged outside the Hono router and its envelope.

### `POST /api/webhook/add-card`

Add a single card directly to the board via the `fb_add_card` Postgres function. Seeds a default board if the user has none.

**Auth:** `secret` in the body, compared against `WEBHOOK_SECRET`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Card title (trimmed) |
| `secret` | string | yes | Webhook secret |
| `column` | string | no | Target column id (default `backlog`) |
| `source` | string | no | Note label (default `Webhook`) — stored as `Added from {source}` |
| `swimlane` | string | no | `work` (default) or `personal` |

**Default columns:** `backlog`, `design`, `todo`, `doing`, `blocked`, `done`.

Success `200`: `{ success: true, message: "Added \"...\" to backlog", cardId }`. Errors: `400` (title required), `401` (invalid secret), `405` (non-POST), `500` (config / DB).

```bash
curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/webhook/add-card \
  -H "Content-Type: application/json" \
  -d '{ "title": "Buy more coffee", "secret": "your-webhook-secret", "source": "Terminal", "swimlane": "personal" }'
```

### `POST /api/slack/actions`

Slack message-action endpoint ("right-click a message → Add to FocusBoard"). Standalone with `bodyParser: false` so the **raw bytes** are read for HMAC verification (the Hono adapter re-encodes form bodies, which would break Slack's signature).

**Auth:** Slack v0 request signature (`x-slack-signature` / `x-slack-request-timestamp`) verified against `SLACK_SIGNING_SECRET`, with a 5-minute replay window. The body is `payload=<url-encoded JSON>` (`message_action`). Captures the message text for `FOCUSBOARD_USER_ID` (source `slack`), idempotent on `team:channel:message-ts`. Non-`message_action` interactions are ack'd `200`. Bad signature → `401`.

### `POST /api/feedback/submit`

Submit a bug report or feature request; adds a tagged card to the feedback owner's backlog.

**Auth:** `Authorization: Bearer <supabase access token>` (verified via `verifySession`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | `"bug"` or `"feature"` |
| `title` | string | yes | Feedback title |
| `description` | string | no | Detail |

Cards are tagged "Bug Report" / "Feature Request" and routed to `FEEDBACK_OWNER_USER_ID`. Errors: `400` (bad type / missing title), `401` (auth), `500` (`FEEDBACK_OWNER_USER_ID` not set).

### AI endpoints (`api/ai/*`)

Five standalone Vercel functions backing the web app's AI helpers. They are **not** Hono routes, **not** in `ROUTE_SCOPES`, and do **not** use the `{ ok, ... }` envelope — each returns ad-hoc `{ success: true, ... }` on success or `{ error }` on failure.

**Shared contract (all five):**

- **Method:** `POST` only (`OPTIONS` handled for CORS; any other method → `405 { error: "Method not allowed" }`).
- **Auth:** `Authorization: Bearer <supabase access JWT>` verified by `verifySession` — a **session principal only** (no PATs, no webhook secret). Missing/invalid → `401 { error: "Unauthorized" }`.
- **LLM:** every endpoint calls **Anthropic Claude Haiku** (`claude-3-5-haiku-20241022`) — these are billable on each request. If `ANTHROPIC_API_KEY` is unset → `500`. Each prompts for JSON and falls back to a deterministic heuristic if the model's output won't parse, so a malformed LLM reply still returns a usable result.
- **Errors:** `400` (missing required input), `500 { error }` (unexpected).

#### `POST /api/ai/breakdown`

Break a task into 3–8 ordered, actionable subtasks for the board. Body: `{ title* (required), notes?, tags?: string[], existingChecklist?: string[] }`. Returns `{ success, subtasks: [{ text, estimatedEffort: "quick"|"medium"|"large" }], suggestion? }`. `max_tokens` 500. Falls back to a generic 3-step checklist if nothing parses.

#### `POST /api/ai/daily-focus`

Pick the top 3–5 cards to focus on today. Body: `{ cards*: CardInput[], completedToday?, avgCycleTime?, wipLimit? }` — blocked/done cards are filtered out first. Returns `{ success, suggestions: [{ cardId, reason, priority: 1|2|3 }], insight? }`; suggestions are validated to reference real card ids. Empty board → friendly insight, no LLM call. `max_tokens` 400.

#### `POST /api/ai/parse-card`

Parse a natural-language task request into structured card fields. Body: `{ input* (required), availableColumns?: {id,title}[], availableTags?: {id,name}[] }`. Returns `{ success, card: { title, column?, tags?, dueDate?, swimlane?, notes? } }`. `max_tokens` 300; falls back to using the raw `input` as the title if parsing fails.

#### `POST /api/ai/suggest`

Suggest 1–3 tags for a card title. Body: `{ title* (required), availableTags?: {id,name}[] }`. Returns `{ success, suggestedTags: string[] }` (tag **names**). `max_tokens` 150.

#### `POST /api/ai/weekly-plan`

Assign due dates across the coming week to unscheduled cards. Body: `{ cards*: CardInput[], weekStart?, avgThroughput?, existingCommitments?: {date,count}[] }` — only cards with no due date and not blocked/done are planned. Returns `{ success, suggestions: [{ cardId, suggestedDate, reason }], weeklyGoal?, capacityWarning? }`; suggestions are validated to reference real cards and dates within the planned week. `max_tokens` 500.

---

## Card data model (`slimCard`)

Board read/mutation routes project cards to a slim shape:

```typescript
{
  id: string;
  title: string;
  column: string;
  swimlane: "work" | "personal";   // defaults to "work"
  order: number;
  dueDate?: string;                  // ISO date, only when set
  tags: string[];                    // resolved to tag NAMES (not ids)
  blockedReason?: string;            // only when set
  notes?: string;                    // capped at NOTES_MAX_LENGTH (5000 chars)
  createdAt: string;
  updatedAt: string;
}
```

Mutation/read responses wrap this as `{ card: { ...slimCard, version } }` (and `archived` on `GET /api/cards/:id`). The full stored `Card` type additionally carries `archivedAt`, `completedAt`, `checklist`, `columnHistory`, `links`, and `attachments`, which the slim projection omits.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side; bypasses RLS — token/board/focus reads & writes) |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Anon key — used by the OAuth authorize handler's `signInWithPassword` |
| `WEBHOOK_SECRET` | Shared secret for webhook + body-secret capture auth |
| `FOCUSBOARD_USER_ID` | The webhook/Slack principal's Supabase user UUID |
| `FEEDBACK_OWNER_USER_ID` | Recipient of feedback submissions |
| `CAPTURE_INTERNAL_SECRET` | Shared secret authenticating the internal `POST /api/capture/process` trigger |
| `ANTHROPIC_API_KEY` | Required for the capture AI extraction pipeline |
| `SLACK_SIGNING_SECRET` | Slack request-signature verification for `POST /api/slack/actions` |

**Finding your User ID:** Supabase dashboard → Authentication → Users → copy the UID.

See [SUPABASE.md](./SUPABASE.md) for database setup.

---

## Extending the API

The API is a **single Hono router**: `api/index.ts` is the only function entry point, and `vercel.json` rewrites `/api/(.*)` → `/api` so every `/api` path that no literal file matches reaches it. All route logic lives in `api/_lib/hono-app.ts`; `index.ts` only bridges Vercel's Node `(req, res)` model to Hono's Web `Request`/`Response` (the Node runtime is deliberate — PAT hashing uses `node:crypto`).

To add a route:

1. Register the handler on `app` in `api/_lib/hono-app.ts`.
2. Add its `METHOD /api/path` entry to `ROUTE_SCOPES` in `api/_lib/auth-middleware.ts` — **a route with no entry is denied**, and `route-scopes.test.ts` fails CI if any registered route is missing.
3. Return via the `ok` / `fail` envelope helpers.

The router **deliberately imports `src/app/*`** (`today.ts`, `filters.ts`, `review.ts`, `captureTypes.ts`, …) so the API renders from the same logic as the web app and can't drift. This reverses the old "API files must be self-contained, never import from `src/`" rule — that guidance applied to the previous per-file Vercel functions and is now obsolete.

The remaining standalone functions exist only where the single-router model can't apply:

- `api/capture/process.ts` — internal AI pipeline, secret-authed, not on the envelope.
- `api/slack/actions.ts` — needs `bodyParser: false` to preserve raw bytes for HMAC.
- `api/webhook/add-card.ts`, `api/feedback/submit.ts` — predate the router; left untouched.
- `api/ai/*` — AI helper functions.

---

## Troubleshooting

### `403 FORBIDDEN` "Route is not registered in the scope table"
You added a Hono route without a `ROUTE_SCOPES` entry. Add `METHOD /api/path` to the table.

### `400 VALIDATION` "version is required" on a mutation
`PATCH`/move/done require a `version`. Pass the integer from `GET /api/cards/:id`, or `version: null` to skip the conflict check.

### `409 STALE_STATE`
The card changed since you read it. Re-read it and retry with the fresh `version`.

### `429 RATE_LIMITED` on capture
You exceeded 30 captures in 60 s for this user. Retry after the window.

### `401` on `POST /api/capture/process`
That endpoint is internal — it requires `internal_secret` matching `CAPTURE_INTERNAL_SECRET`. It's normally only called by `POST /api/capture`.

### 404 on a multi-segment path
Confirm `vercel.json` still rewrites `/api/(.*)` → `/api`; multi-segment paths only reach the router through that rewrite (the `GET /api/health/deep` gate guards against regressions).

### Cards not appearing
Cloud sync must be enabled (Supabase creds configured) and the web app opened once to seed the board. Mutations fire the realtime path; refresh an open tab if it didn't update live.
