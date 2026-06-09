# Focusboard Handoff — CLI/MCP Operating Layer (Phase 0 shipped)

**Date:** 2026-06-09
**Plan:** `docs/plans/2026-06-09-cli-mcp-operating-layer-v2.md` (architecture-reviewed; supersedes the original). Read it + this handoff first.
**Prod:** https://focusboard-claire-donalds-projects.vercel.app · **Supabase project ref:** `pqjzwyrhcqczplrubfqs`

## TL;DR
**Phase 0 — the server foundation for the CLI + MCP — is BUILT, MERGED, DEPLOYED TO PROD, and runtime-verified.** Next is **Phase 1: the actual `fb` CLI + the MCP server** on top of this API. No code-level work is blocked.

---

## Done (live in prod)
- **PAT auth model** — `api_tokens` table (SHA-256-hashed tokens, per-token scopes, revocable). **Migration applied to prod** via the Supabase Management API + verified (8 cols, RLS, 4 own-row policies; `capture_queue.idempotency_key` added).
- **Single Hono router** at `api/[...path].ts` (Node-runtime adapter → `app.fetch()`). All CLI/MCP endpoints live here as routes; legacy `api/` functions (ai/*, process, feedback, webhook) untouched. **9 serverless functions total** (under Vercel Hobby's 12 cap; stays stable because new endpoints are *routes*, not files).
  - `api/_lib/token.ts` — token generate/hash/resolve/scopes.
  - `api/_lib/auth-middleware.ts` — unified `authenticate()` (**PAT > webhook > session**) + **route→required-scope table** (deny-by-default) + `requireScope`/`requireSession`.
  - `api/_lib/hono-app.ts` — the routes (importable by tests via `app.fetch`).
- **Endpoints:** `GET /api/capture` (inbox) · `POST /api/capture` (capture | `action:snooze` | `action:dismiss`; rate-limit, `Idempotency-Key`, AI auto-add disabled for PAT) · `GET/POST/DELETE /api/tokens` (session-only).
- **Settings → API Tokens UI** — create (one-time reveal) / list / revoke; gated on a real session (shows "Sign in to manage…" when not logged in).
- **Merged PRs:** #18 (Phase 0 + Hono migration), #19 (token-UI session gate). Both runtime-verified on prod with Playwright.

## Architecture decisions (locked, in the plan)
- **No Vercel Pro.** One Hono router function per app — the 12-fn cap stops mattering, free, portfolio-wide. Buy Pro only on a Pro-shaped trigger (a route needing `maxDuration>60s`, real concurrency, team seats).
- **Route→scope table** is the single source of API auth policy (deny-by-default).
- Phase-4 concurrency strategy still **to decide**: extract a normalized `cards` table (recommended — fixes a latent web-app last-writer-wins data-loss bug) vs. a `version` column + conflict-aware web saves. Decide before Phase 2 (it dictates whether reads return a version/etag).

---

## NEXT — Phase 1: the `fb` CLI + MCP server (build on the live API)
1. **`cli/` workspace package (in-repo):** a shared API-client module + commands `fb capture | inbox | inbox dismiss | snooze | auth`. Design (from the UX review): **session-scoped short aliases** (`cap-1`) not UUIDs; table output + `--json`/`--quiet`/`--no-color`; errors carry a next-action hint; **AI-absent = a warning, not an error**. Auth: device-flow or `--token` paste; store at `~/.config/focusboard/credentials.json` (`0600`, never in a repo).
2. **MCP server (local stdio):** `focusboard_capture | inbox | snooze_capture` (Tier 1), sharing the **same API-client module** as the CLI. Naming: `focusboard_<noun>` = read, `focusboard_<verb>_<noun>` = write. Three permission tiers; a Tier-3 confirmation-token gate comes with mutation (Phase 4).
3. To get a token for the CLI today: **Settings → API Tokens → Create** (UI is live).

### Later phases (per the plan)
- **P2 read-only board** (`/today`,`/cards`,`/search`,`/wip`) — reads return a version/etag.
- **P3 focus sessions** — **extract a `focus_sessions` table first** (focus history currently lives in the `app_state` blob = already a mutation).
- **P4 card mutation** — **blocked** until concurrency solved (see decision above); define a **409** conflict contract.
- **P5 agent-native workflows** — compose the smaller tools.

---

## How to work here (read before touching the API)
- **New endpoints = new ROUTES** in `api/_lib/hono-app.ts` + a `ROUTE_SCOPES` entry in `api/_lib/auth-middleware.ts`. **Do NOT add new top-level `api/*.ts` files** — that re-hits the 12-fn cap.
- **Typecheck gotcha:** `npm run typecheck` (`tsc -b`) does **NOT** cover `api/`. Run **`npx tsc --noEmit -p tsconfig.eslint.json`** to type-check `api/` the way Vercel's per-function builder does — otherwise an `api/` type error only fails at the Vercel deploy.
- **Tests:** `npm run test:api` (api/**/*.test.ts; `vitest.api.config.ts`; `.vercelignore` keeps them out of the deploy) and `npm run test:run` (src).
- **Migrations:** applied **manually** (no CI). Use the **Supabase Management API / dashboard SQL editor**, NOT `supabase db push` (the remote migration history isn't in sync → `db push` would re-apply old migrations and error).
- **Deploy = merge to `main`.** **ALWAYS runtime-verify the deployed artifact** — `curl` the route / Playwright the UI. Green CI is NOT proof (the Hono catch-all passed build + 661 tests + deploy + cross-model review and still **504'd every route** until a live `curl` caught a Web-handler-on-Node-runtime bug). **Preview deploys are SSO-protected** → verify on prod.

## Gotchas (cost real time — don't relearn)
- `hono/vercel` `handle()` returns a **Web handler that 504s on Vercel's Node runtime** → the `(req,res)→app.fetch()` adapter in `api/[...path].ts` is required. Keep the **Node** runtime (PAT hashing uses `node:crypto`; Edge lacks it).
- Vercel **Hobby = 12 functions/deploy** (Fluid Compute doesn't change the count). We're at 9.

## Still pending (your hands, ~1 min)
Full token→capture loop hasn't been run with a **real** token (I can't read your prod user). To confirm: Settings → API Tokens → **Create**; then
`curl -X POST https://focusboard-claire-donalds-projects.vercel.app/api/capture -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"content":"smoke test"}'`
→ expect `200` + `{captureId}` → appears in Capture Inbox → revoke the token.

## ShipIt V4 — the OTHER thing to evolve next session
The whole point of this session was to improve ShipIt; FocusBoard was its first real-world test. **Plan + honest retro:** `~/code/shipit-v4/docs/plans/2026-06-09-v4-improvement-plan.md` (PR #10). Read it to start the next ShipIt session.

**Assessment in one paragraph:** V4's thesis held but inverted from how it was sold — the *cheap* parts carried it (ad-hoc specialist summon was the highest-value output; the architect's plan review prevented a bad build; mechanical gates + the retro loop worked and self-improved). The *expensive headline* feature, the cross-model review, underdelivered: ~7 calibration rounds, real bugs, and it **passed GREEN on the PR that 504'd every route** — no diff review catches a runtime bug. V4's real blind spot was **no runtime verification** (every gate green on a dead deploy); patched mid-flight with the new `runtime-smoke-test` gate.

**Prioritized fixes (in the plan; 3 routed to `shipit-v4/PROPOSED-LEARNINGS.md`):**
- **P1** finish wiring the smoke gate so it fires by itself — into `install-gates.sh` + `ci-templates/ci.yml` (today only `/ship` prose) + **auto deploy-URL discovery**.
- **P2** demote + de-noise the cross-model review to **advisory** (off the required-check path); structured `VERDICT:` parsing not prose-grep; size-gate off trivial PRs.
- **P3** make **ad-hoc specialist summon** a first-class documented pattern.
- **P4** battle-test on 2–3 repos (`n=1` is not "proven").

## Related (this session)
- **The new `runtime-smoke-test` gate** (HTTP curl + Playwright UI render + `SHIPIT_SMOKE_E2E_CMD` hook for Cypress/Playwright/Cucumber) — **FocusBoard is its first customer:** when wiring `/ship` here, set `SHIPIT_SMOKE_PATHS=/api/capture`, `SHIPIT_SMOKE_UI=1`.
- `~/.claude` global rules updated: "green CI ≠ runtime works" (MANDATORY #4) + the Vercel `api/`-typecheck & 12-fn/Hono-504 facts.
