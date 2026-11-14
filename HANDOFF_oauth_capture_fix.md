# HANDOFF — OAuth capture fix (POST /api/capture + capture_actions batch)

**Written 2026-07-20 (Cowork session). Status: patched, uncommitted, NOT deployed.**
Picks up the self-reported bug in the FocusBoard capture inbox (capture id
`295712e7`): the MCP write path is broken for claude.ai connector (OAuth) callers.

## What was broken (two defects, both in that capture)

1. **`POST /api/capture` rejects OAuth tokens.** It's the only `INLINE_AUTH`
   route, so it authenticates itself instead of using the shared `authenticate()`
   middleware. Its chain was **PAT → webhook secret → session JWT**, with no OAuth
   branch — so an `fb_oat_...` token isn't a PAT, has no body `secret`, and falls
   into the session branch where `supabase.auth.getUser()` rejects it with a
   misleading `NOT_AUTHENTICATED` ("Missing or invalid credentials").

2. **`focusboard_capture_actions` fails batch validation.** The MCP tool forwarded
   `items` as bare strings, but `POST /api/capture/batch` requires `[{ content }]`
   objects, so every schema-conformant call 400'd.

## What I changed (2 files, +29 / −2, uncommitted)

### `api/_lib/hono-app.ts`
- Added `resolveOAuthToken` to the `./token.js` import.
- In the `app.post("/capture", …)` INLINE_AUTH handler, added an **OAuth branch**
  between the PAT and webhook branches, mirroring the existing PAT branch:
  - `const oauthResolved = patResolved ? null : await resolveOAuthToken(authHeader)`
  - enforces the same `SCOPES.CAPTURE_WRITE` via `principalHasScope(…, kind: "oauth")`
  - sets `isPatCapture = true` so an OAuth capture keeps the same safe posture as a
    PAT: rate-limited, idempotency-tracked, and **auto-add disabled** (lands in the
    inbox for triage, does not jump onto the board).

### `api/_lib/mcp-server.ts`
- In the `focusboard_capture_actions` case, normalise items before POSTing:
  `string → { content }`, leaving already-shaped objects untouched. Fixes the
  batch fallback so it validates.

Both changes reuse existing, working patterns — the OAuth branch in
`auth-middleware.ts::authenticate()` and the PAT branch in the same capture handler.
`PrincipalKind` already includes `"oauth"`; `resolveOAuthToken` returns the same
`{ userId, scopes, tokenId }` shape the PAT branch uses.

## Verification status — IMPORTANT
- **Static only.** The Cowork session that made these edits could not run the
  toolchain (`node_modules` absent; TypeScript/Vitest not installed, no network
  pull). Types were checked by reading the code, not by `tsc`.
- **Nothing was committed, pushed, or deployed.** Working tree shows only the two
  files above modified.

## To finish (run in Claude Code / terminal)
```bash
cd ~/code/focusboard
npm ci
npm run typecheck:api
npm run test:api          # watch: capture-pat, oauth, mcp-server, mcp-contract, route-scopes
```
If green, commit + open a PR. Suggested (matches repo's conventional-commit style):
```
fix(api): accept OAuth (fb_oat_) tokens on POST /api/capture + normalise capture_actions batch payload

POST /api/capture is INLINE_AUTH and had no OAuth branch, so fb_oat_ tokens fell
through to supabase.auth.getUser() and returned NOT_AUTHENTICATED. Add an OAuth
branch mirroring the PAT path (scope capture:write, auto-add disabled).
Also normalise focusboard_capture_actions items (string -> {content}) to satisfy
/api/capture/batch validation. Fixes the connector write path (capture 295712e7).
```

## Suggested regression test (not yet written)
Add to `api/capture/capture-pat.test.ts` (or a new `capture-oauth.test.ts`): a
valid `fb_oat_` token with `capture:write` returns 200 and inserts a
`status:"pending"` row, and an expired/revoked one returns 401. Mirror the
existing PAT capture test. Optionally assert `capture_actions` accepts
`["a","b"]` (strings) end-to-end.

## Why this matters
The self-verifying daily-briefing pipeline (in the Claudesidian vault:
`.claude/skills/daily-briefing/`) has `write_enabled: true`. Its Stage-4 writes
are FocusBoard inbox captures via this exact path. Until this fix deploys, those
writes fail both primary and batch endpoints and land in the brief's "Degraded
Systems" section with payloads preserved. Deploying this takes the write layer
out of degraded mode.
