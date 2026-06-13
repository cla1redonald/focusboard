# HANDOFF — 2026-06-13

**Prod:** https://focusboard-claire-donalds-projects.vercel.app · **Supabase ref:** `pqjzwyrhcqczplrubfqs`
_(Supersedes the 2026-06-10 CLI/MCP handoff — that work, Phases 0–6, all shipped.)_

## Session Summary

Two big arcs this session.

**1. Capture system (personal prototype) — built, hardened, documented.**
- Capture into FocusBoard from anywhere on Claire's devices: an Apple **Shortcut** +
  **Action Button** (iPhone), a Mac **Services hotkey**, and **email** capture.
- Root cause solved: **Apple Shortcuts (NSURLSession) cannot reach Vercel's edge** (-1005);
  a Vercel custom domain did NOT fix it. Fix = a **Cloudflare Worker** at
  `focusboard-capture.cla1re.workers.dev` (Shortcuts can reach Cloudflare) that forwards to
  the capture API and injects the token.
- **Email capture** = 3 Google **Apps Scripts** (clasp projects: roami, clairedonald1982,
  rational) that flag/star-to-capture OR forward to alias `claire+focusboard@roami.group`,
  POST to the Worker every 5 min. Robust: success-only labelling (no silent loss) + throttled
  failure alerts.
- **Security hardening:** the Worker was an open relay → now requires an **`X-FB-Key`** secret
  header (`CAPTURE_PROXY_SECRET`); secret in `~/.config/focusboard/worker-proxy-secret.txt`,
  embedded in the Shortcut header + all 3 scripts. (See memory `shortcuts-vercel-proxy`.)

**2. Documentation overhaul + harness fix (@retro).**
- Reviewed all 30 docs vs code. `API.md` (~4/35 routes) and `SUPABASE.md` (~25% schema) were
  badly stale; `CAPTURE.md` actively misleading. **All rewritten and verified against code.**
- New strategy docs: `docs/PRODUCT-THESIS.md`, `docs/MULTI-USER-CAPTURE.md`,
  `docs/PERSONAL-INTELLIGENCE.md`, `docs/CAPTURE-PROTOTYPE-AUDIT.md`.
- **@retro root cause:** the `docs-check` gate was a TOUCH gate (did *a* doc change?) not a
  CONTENT gate — so reference docs rotted while CI stayed green. Built
  **`.shipit-gates/check-docs-coverage.sh`** (content-coverage: every ROUTE_SCOPES route +
  standalone `api/*` function + migration table/function must be named in the docs).
  Propagated to the shipit-v4 canonical + CI template. The gate caught its own gaps twice
  (3 missed routes; 2 robustness bugs in the FUNCS manifest) — all fixed.
- Confirmed the **OAuth stub migration IS applied in prod** (oauth_clients 13, oauth_tokens 16).

PRs merged: focusboard **#53, #54**; shipit-v4 **#29, #30**.

## Current State
- **Branch:** `main` (synced with origin). Working tree clean except untracked `supabase/.temp/`.
- **Last commit:** `70dbe94` Merge PR #54.
- **Deploy:** Vercel deploys green on all merged PRs; runtime-smoke passing.
- **CI/tests:** all gates green on main (test, review, runtime-smoke, docs-sync, **docs-coverage**).
- **Live infra:** Cloudflare Worker `focusboard-capture` (secrets `FB_TOKEN`, `CAPTURE_PROXY_SECRET`);
  3 Apps Script projects with 5-min triggers; custom domain `focusboard.roami.help` (Vercel).

## Open Issues
- **Multi-user capture is NOT built** — designed only (`docs/MULTI-USER-CAPTURE.md`). The whole
  capture system is **single-tenant (Claire-only)**: the Worker injects her token; the
  alias/scripts/Shortcut are all hers. Build order: multi-user capture **before** the
  intelligence layer.
- **Personal-intelligence layer NOT built** — designed only (`docs/PERSONAL-INTELLIGENCE.md`).
- **flag-to-capture is personal-only** (dropped from the product design — most people use flags
  for other things; Gmail restricted-scope OAuth not worth it).
- **Per-capture AI cost** at multi-user scale is unbudgeted — `api/capture/process.ts` + the 5
  `api/ai/*` endpoints each call Claude Haiku on every request. Plan: heuristic fast-path +
  capped async AI (MULTI-USER-CAPTURE.md §5 / PERSONAL-INTELLIGENCE.md §6).
- **Known prototype flaws** in `docs/CAPTURE-PROTOTYPE-AUDIT.md` (single token = single point of
  failure; 5-min email latency; messy forwarded-email parsing; 3 duplicated scripts).
- No new bugs introduced; the docs-coverage gate is now the wall against doc drift.

## Resume Prompt
```
Pick up FocusBoard. Last session: shipped a single-user capture prototype (Cloudflare
Worker + Apple Shortcut/Action Button + Mac hotkey + email via 3 Google Apps Scripts,
secured with an X-FB-Key header), then overhauled all stale docs and added a
content-coverage docs gate to the ShipIt harness (root cause: the old gate only checked
THAT a doc changed, not WHAT it said). All merged to main (PRs #53/#54 focusboard,
#29/#30 shipit-v4).

Next major work is MULTI-USER CAPTURE — turning the Claire-only glue into a real per-user
feature. Read docs/MULTI-USER-CAPTURE.md (architecture + 5-phase plan; the core API/DB is
already multi-tenant, it's the glue that's single-user) and docs/PRODUCT-THESIS.md +
docs/PERSONAL-INTELLIGENCE.md (the AI/data layer to build AFTER multi-user). Start with
Phase A (capture_connections/capture_addresses tables, expose OAuth routes, Integrations
UI scaffold). Branch then PR — never push to main. The docs-coverage gate will require any
new route/table/function to be documented in API.md/SUPABASE.md.
```
