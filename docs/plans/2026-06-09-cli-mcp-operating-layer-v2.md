# Focusboard CLI + MCP Operating Layer — Plan v2 (architecture-reviewed)

Date: 2026-06-09
Supersedes: `2026-06-09-cli-mcp-operating-layer.md` (the original is kept for history).

This revision incorporates an **architecture review against the actual codebase** and an **operator-UX review**. The original plan's thesis (one API boundary, never direct Supabase writes, risk-ordered phases, capture-first) is sound. Two things it got wrong or understated are corrected here.

## What the architecture review changed (read this first)

1. **The "API boundary" is only half real today.** Capture *write* has a genuine server API (`POST /api/capture`). But **inbox read, snooze, and all board/card access do not exist as a server API** — the web app does them browser-side via the user's RLS-scoped Supabase session (`useCaptureQueue.ts`, `sync.ts`). So `fb inbox`/`fb snooze` in the original "first slice" cannot be built as written without **new endpoints + a real auth model**. The acceptance line "No direct Supabase writes from CLI or MCP" is correct as a goal but **currently false by construction for reads** — that's the one line that would lead an implementer to do the wrong thing.
2. **There is no honest CLI/MCP auth model yet.** Session JWTs are 1h + refresh-rotation (a CLI re-implementing GoTrue is fragile and holds full account creds). The webhook secret is a single global, unscoped, unrevocable secret. → **A Personal Access Token (PAT) model is a prerequisite, not a later risk.**
3. **Phase 1 is not purely append-only.** A high-confidence capture auto-adds a card into the board blob (`process.ts:217`) — inheriting the Phase-4 concurrency hazard. Disable AI auto-add for external captures until locking exists.
4. **Phase 3 (focus sessions) is mis-ordered.** Focus history lives *inside* the `app_state` blob, so "start/stop a focus session" is already a board mutation with the same last-writer-wins risk reserved for Phase 4. Extract a `focus_sessions` table.
5. **Phase 4 is blocked on concurrency.** The board is one JSONB row per user with blind full-document upserts (`sync.ts`, `add-card.ts`, `process.ts`) — last writer wins, silently. This is a **real, existing data-loss path**. Card mutation must not ship until either a `version` column + conflict-aware web saves, or a normalized `cards` table, exists.

## Phased plan (revised)

### Phase 0 — Auth + the API boundary (NEW prerequisite)
The thing the original plan filed under "Risks." Promote it.

- **`api_tokens` table** (Supabase migration): `id, user_id, token_hash (SHA-256), name, scopes text[], last_used_at, created_at, revoked_at`. Token format `fb_pat_<random>`; client sends `Authorization: Bearer fb_pat_...`. A resolver helper alongside `verifySession` maps token → hash lookup → `user_id` + `scopes`. Replaces `FOCUSBOARD_USER_ID` for external callers; per-token scoping (`capture:*` now, `card:write` later); revocable.
- **A token-issuing path** for the user (a settings page or a one-off script) — issue once, show the plaintext once, store only the hash.
- This is small (one table + one resolver) and future-proofs multi-device / eventual multi-user.

### Phase 1 — Capture (capture / inbox / snooze)
- **API:** `POST /api/capture` (exists — add PAT auth + `scopes` check + **idempotency key** + **per-token rate limit**). New: `GET /api/inbox`, `POST /api/capture/:id/snooze`, `POST /api/capture/:id/dismiss` — real server endpoints using the service-role key with `user_id` from the resolved PAT (same trust model as the webhook, but scoped + revocable).
- **External captures: AI auto-add DISABLED** (land everything in inbox as `ready`, never `auto_added`) so Phase 1 stays genuinely append-only.
- **CLI:** `fb capture <text>`, `fb inbox`, `fb inbox dismiss <id>`, `fb snooze <id> --minutes 60`.
- **MCP:** `focusboard_capture`, `focusboard_inbox`, `focusboard_snooze_capture` (Tier 1 — capture-safe).
- Captures into `capture_queue` are append-only, per-row UUID, RLS-correct, already realtime-enabled → the web inbox shows CLI captures **live, for free**.

### Phase 2 — Read-only board
- **API:** `GET /api/today`, `GET /api/cards?status=`, `GET /api/cards/search?q=`, `GET /api/wip`. **Each read returns a board `version`/etag** (set up now so Phase-4 mutation can echo it back).
- **CLI:** `fb today`, `fb list [--status]`, `fb search <q>`, `fb wip`.
- **MCP:** `focusboard_today`, `focusboard_search`, `focusboard_wip`, `focusboard_metrics` (Tier 2 — read-board).

### Phase 3 — Focus sessions (extract a table first)
- **Extract `focus_sessions`** (append-only, event-shaped: `id, user_id, card_id?, started_at, ended_at, outcome`) out of the `app_state` blob — this de-risks Phase 3 the way `capture_queue` de-risks Phase 1, and removes a blob-mutation hazard.
- **API:** `POST /api/focus/start`, `POST /api/focus/stop`, `GET /api/focus/status`.
- **CLI:** `fb focus start [<card-id>]`, `fb focus stop --outcome <…>`, `fb focus status`.
- **MCP:** `focusboard_focus_start/stop/status` (Tier 3 — mutation, but on the safe append-only table).

### Phase 4 — Controlled card mutation (gated)
**Do not ship until concurrency is solved.** Recommended: **extract a normalized `cards` table** (per-card RLS, single-row updates, natural per-card optimistic locking) — this also fixes the latent web-app data-loss bug. Cheaper alternative: `version BIGINT` on `app_state` + make **web saves conflict-aware** (read version on load, send on save, refetch-and-rebase on 409). Either way, define **409 Conflict** as the conflict contract so the CLI can render "board changed, re-run".
- `fb add`, `fb move <id> <col>`, `fb done <id>`, tags, blocked.
- MCP Tier 3 with the confirmation-token gate (below).

### Phase 5 — Agent-native workflows
Compose the smaller tools (capture meeting actions, show stale WIP, prepare daily shutdown). Unchanged from the original.

## Operator UX (from the design review)

### CLI
- **Session-scoped short aliases** (`cap-1`, `c-42`) in all human output; the CLI maps alias → full ID and sends the full ID to the API. `--json` always returns both.
- **Command shape:** `fb inbox add/dismiss` as sub-commands (not top-level verbs); `fb capture` (→ AI queue) and `fb add` (→ direct card, Phase 4) stay distinct; `fb auth login/status/logout`.
- **Output:** table-ish, monochrome-safe (dots `●●` for urgency, block-char progress bars), shows the **AI-parsed title** in `fb inbox` so bad parses are caught at a glance.
- **Flags everywhere:** `--json` (machine-readable, full IDs), `--quiet`, `--no-color` (respect `NO_COLOR` + non-TTY).
- **Errors:** `Error:` (blocking) / `Warning:` (degraded) / no-prefix (info); never raw stack traces; always a next-action hint. **AI absent = a warning, not an error** (capture still works).
- **Auth UX:** device-auth flow (or `--token` paste fallback); store at `~/.config/focusboard/credentials.json`, `0600`; never print the token; `fb auth status` shows email only.

### MCP
- **Read tools `focusboard_<noun>`** (no `get_`); **write tools `focusboard_<verb>_<noun>`** — the read/write split is visible in the name.
- **Three permission tiers**, declared per tool: Tier 1 capture-safe · Tier 2 read-board · Tier 3 board-mutation.
- **Tier 3 confirmation gate:** a mutation tool returns `{ status: "confirmation_required", confirm_token, expires_in }`; the agent must call `focusboard_confirm` to execute. Makes silent agent mutation impossible.
- **Structured envelopes:** `{ ok, data, meta }` / `{ ok, error: { code, message, hint } }`. The `hint` field tells the agent the next tool to call. Stable error codes: `NOT_AUTHENTICATED, NOT_FOUND, STALE_STATE, WIP_LIMIT, AI_UNAVAILABLE, CONFIRMATION_REQUIRED`.

## Packaging
- **CLI:** in-repo workspace package (`cli/`, own `package.json` + `bin`), shares `src/app/types.ts` + the capture source enum; publish standalone later only if needed. (Repo is already `"type": "module"`.)
- **MCP:** local stdio first (single-user, holds a PAT); hosted later. Reads the PAT from the keychain/credentials file.
- **One shared API-client module** used by both CLI and MCP — the single place that knows endpoints, the auth header, and error mapping (the "one place owns the rules" principle, applied client-side).
- **Deprecate or fold `api/webhook/add-card`** behind the PAT model so there aren't two unscoped write paths.

## Cross-cutting (do at Phase 1, painful to retrofit)
- **Idempotency** on capture (`Idempotency-Key` header or `hash(user_id+content+minute)` + unique index).
- **Rate limiting** per token (and do not auto-trigger Anthropic processing for agent-sourced captures — real $ cost in `process.ts`).
- **A formal error contract** (the codebase already returns `{ error }` + status codes — formalize; reserve 409 for the lock conflict).

## Revised first build slice (Phase 0 + Phase 1)
1. `api_tokens` table + Bearer-PAT resolver; a way to issue one token for Claire.
2. `GET /api/inbox`, `POST /api/capture/:id/snooze`, `POST /api/capture/:id/dismiss`; PAT auth + idempotency + rate limit on capture; AI auto-add disabled for external captures.
3. `cli/` package: a shared API client + `fb capture | inbox | inbox dismiss | snooze | auth`.
4. MCP (local stdio): `focusboard_capture | inbox | snooze_capture` (Tier 1) on the shared client.

**Acceptance (revised):** CLI captures into prod; web Capture Inbox shows it live; MCP captures identically; snooze hides until due (persisted); **no direct Supabase from CLI/MCP** (now actually true, because the read API + PAT exist); PAT stored `0600` outside git; idempotent capture; rate-limited; CI green; prod smoke-tested. This is a `/ship`-sized slice (V4 — not `/orchestrate`).

## Phase 0.5 — hardening (added 2026-06-09, post-Phase-0 code review)

A code review of the shipped Phase 0 against this plan found three gaps worth fixing
BEFORE the CLI/MCP clients freeze the API contract. Shipped as the `phase0.5-hardening` PR:

1. **The route→scope table is now actually enforced.** Phase 0 shipped `ROUTE_SCOPES` as
   documentation — nothing consumed it; each route attached middleware by hand, so a
   forgotten middleware shipped an OPEN route. Now a single app-wide `enforceRouteScopes`
   middleware drives all header auth from the table, a matched route with no entry is
   denied (403 — fails closed), and a test asserts every registered route has an entry
   (so a miss fails CI before it fails a request). `POST /api/capture` is the one
   declared `INLINE_AUTH` exception (webhook secret lives in the body).
2. **CORS origin check is hostname-parsed.** The substring check
   (`includes("focusboard") && includes("vercel.app")`) admitted
   `https://focusboard.vercel.app.evil.com`. Now: parsed hostname must start with
   `focusboard` and end with `.vercel.app` over https. Fixed in both the Hono app and
   the legacy `api/_lib/cors.ts`. (Severity was moderate — auth is header-based, not
   cookie-based — but with `credentials: true` it was wrong.)
3. **The API contract is frozen in its final shape, pre-CLI.** REST routes
   (`POST /api/capture/:id/snooze`, `POST /api/capture/:id/dismiss`,
   `DELETE /api/tokens/:id`) replace the Phase-0 `action`-multiplex and body-id forms
   (artifacts of the pre-Hono 12-function squeeze; zero external clients existed, so
   zero migration cost). Every response now uses the formal envelope —
   `{ ok: true, data }` / `{ ok: false, error: { code, message, hint? } }` with stable
   codes (`NOT_AUTHENTICATED, INSUFFICIENT_SCOPE, SESSION_REQUIRED, FORBIDDEN,
   VALIDATION, NOT_FOUND, METHOD_NOT_ALLOWED, RATE_LIMITED, INTERNAL`; `STALE_STATE`/409
   reserved for Phase 4) — in `api/_lib/envelope.ts`. This was planned as an MCP-layer
   concern; it is an API-layer concern, owned server-side.
4. Smaller fixes: `last_used_at` stamped via `waitUntil` (fire-and-forget writes can be
   frozen mid-flight after the response on Vercel); `resolveApiToken` takes the auth
   header string (no more `VercelRequest` shims); anchored case-insensitive Bearer strip.

Deliberately NOT in 0.5 (would need a prod migration; do alongside a later phase):
token display prefix (show `fb_pat_…x7Kq` in Settings) and optional `expires_at`.
Rate limiting remains per-user, not per-token — fine single-user; revisit at multi-device.

## Open decisions to confirm
1. **Phase-4 concurrency — DECIDED (2026-06-09): extract a normalized `cards` table.**
   Per-card rows give natural per-card optimistic locking and fix the latent
   last-writer-wins data-loss path in web saves. Consequence: **Phase-2 reads do NOT
   need version/etag plumbing** (the lock unit is the card row, not the board blob) —
   Phase 2 gets simpler. The extraction itself still lands with Phase 4.
2. **Token issuance UX:** a settings page in the web app vs. a one-off admin script for now.
   *(Resolved in practice: the Settings → API Tokens page shipped with Phase 0.)*
3. **MCP confirmation gate:** ship it from Phase 3 (first mutation), or Tier-1/2 only until Phase 4.

## Architecture decisions (2026-06-09, post architecture re-review)

Triggered by Phase 0 hitting Vercel's **Hobby cap of 12 serverless functions per deployment** (still current, 2026; Fluid Compute does NOT change the function *count*). Reviewed by the architect; decided:

- **Do NOT upgrade to Vercel Pro for this.** Consolidating endpoints into resource-functions is a treadmill — even disciplined, the API breaches 12 again at Phase 4 (the 5 `ai/*` functions alone eat ~half the budget). Pro (~$20/mo) would just pay to preserve the sprawl pattern across the whole portfolio.
- **Standing API shape: ONE router function per app.** Migrate the entire `api/` to a single **Hono** app — now at `api/index.ts` with a `vercel.json` rewrite `/api/(.*) → /api` (a `[...path].ts` catch-all only matched SINGLE-segment paths on Vercel's filesystem router; multi-segment routes platform-404'd without ever invoking the function — found by runtime verification in Phase 0.5). Per-route handlers; `req.url` keeps the original path through the rewrite, so the Hono router is unaffected. All endpoints collapse to 1 function; the 12-cap stops being a design constraint, free, forever — on every project. Bonus: better cold-starts, cleaner tests (`app.request()`), and *less* lock-in (web-standard `Request`/`Response` vs Vercel-specific signatures). Done as its own refactor **before Phase 2** so later phases add routes (one line) not files (one function).
- **Auth: a route → required-scope table in `_lib`** (deny-by-default, fails closed), enforced by one middleware before handlers run. Unify the three auth ladders (PAT > webhook secret > session) into one `authenticate(req)` → `{ userId, scopes, authKind }`. Folds the webhook secret into the PAT model as just another principal. Set this convention NOW (cheap at 3 actions; load-bearing by Phase 4's ~17).
- **Buy Vercel Pro only on a Pro-shaped trigger, per project, deliberately:** a route needing `maxDuration > 60s` (heavy AI/render), real concurrency, team seats, or protected previews. Keep a one-line note in each repo of which trigger would justify it. FocusBoard has none today.
- **Portfolio rule:** "one Hono router function per Vite/SPA-on-Vercel app" is the default for all projects.
