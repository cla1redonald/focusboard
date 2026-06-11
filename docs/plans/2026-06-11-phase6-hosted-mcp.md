# Phase 6 — Hosted MCP (FocusBoard everywhere: Cowork, claude.ai, mobile)

**Status:** ARCHITECTURE-REVIEWED rev 2 · auth decision MADE: **Option A (single-principal
OAuth stub)** chosen 2026-06-11 · 6.0 probe in flight.
**Probe finding #1 (from Claire's first connector attempt, before the endpoint was even live):**
claude.ai attempts OAuth discovery/registration against `/.well-known/oauth-*` when adding a
connector — and Vercel's SPA fallback rewrite served index.html with HTTP 200 for those paths,
which claude.ai read as a broken sign-in service ("Couldn't register"). Fixed: `/.well-known/*`
now rewrites to the API function (proper 404 until the OAuth stub provides real metadata).
The stub's discovery endpoints are therefore CONFIRMED load-bearing for 6.2, not optional.
**Context:** Phases 0–5 shipped. The MCP server is local stdio (`fb mcp`), which works
in Claude Code but NOT in Cowork / claude.ai web / mobile — custom connectors are
reached over HTTPS from Anthropic's cloud only. The original plan anticipated this:
"MCP: local stdio first; hosted later." Strategic driver: the Todoist→FocusBoard
migration sticks only if FocusBoard matches Todoist's everywhere-reach.

## Goal

A remote MCP endpoint on the existing API exposing the SAME tool surface, tiers,
and confirmation gate as the stdio server — addable as a claude.ai custom
connector, hence usable in Cowork, web, and mobile, nothing running locally.

## Hard constraints (carried)

Routes in the one Hono app (12-fn cap) · Node runtime + (req,res)→app.fetch
adapter · ROUTE_SCOPES deny-by-default (CI-enforced) · the `{ok,data}/{ok,error}`
envelope · smoke-account verification (ONE unavoidable manual act: Claire adds
the connector URL in the claude.ai dialog — a genuinely GUI-only step).

## Review verdicts that shape the design (rev 1 → rev 2)

1. **Transport is structurally safe** (verified against @hono/mcp 0.3.0 source):
   with `enableJsonResponse: true` the POST handler returns a fully-buffered
   `ctx.json()` Response — our Node adapter drains it; the hono/vercel-504 class
   cannot recur. The REAL risk moved: what the actual claude.ai connector sends
   (Accept headers, a GET/SSE channel attempt, its timeout) — the official SDK
   client negotiates politely and would NOT catch a connector-specific mismatch.
   → **A real-connector probe is now step 0.**
2. **The durable gate is forced and sound**, with two invariants made explicit:
   (i) confirm resolves the caller's principal FIRST and requires it to equal
   the stored row's user_id (the closure used to give this for free — now it's
   a tested guard); (ii) execution stays on the FocusboardClient → public-API
   path so ROUTE_SCOPES keeps enforcing — NEVER direct service-role execution.
   Note: `add_card` has no CAS by nature (append-only, benign); moves/mutates
   keep freshness because the EXECUTORS re-read versions (4a/5b property).
3. **Capability-in-URL auth was BLOCKED as specified**: Vercel logs request
   paths, so `/api/mcp/<secret>` writes the live credential to our own logs on
   every call (plus Anthropic's stored copy). The listed mitigations were
   security theatre against that. See the auth decision below.
4. **Reads go in-process, writes via the public API**: a 20-card plan preview
   over self-HTTP = ~20 extra function invocations and a connector-timeout risk
   (especially Cowork). Hosted tool PREVIEWS/validation use the in-process
   `loadBoard`/readers; WRITE dispatch keeps the public-API path (scope
   enforcement stays single-point).
5. **6a splits into two PRs** — the gate ships and proves itself on the
   EXISTING stdio server before any transport lands.
6. **Own `mcp_capabilities`/auth table** — don't pollute the clean PAT model.
7. **Honesty about Cowork**: the SDK-client harness proves the endpoint, not
   Cowork. Tool-count caps, stricter schema validation, tighter timeouts, and
   confirm-token survival across Cowork turn boundaries are only provable in a
   real Cowork session. One manual Claire glance closes that — stated, not hidden.

## THE OPEN DECISION — auth posture (Claire to pick)

- **Option A — single-principal OAuth stub (recommended):** a minimal OAuth 2.1
  AS on the Hono app: DCR + PKCE + an authorize page that verifies CLAIRE
  (Supabase password/session — the stub MUST authenticate her, or anyone
  completing the flow would get her principal) + a token endpoint minting
  short-lived access tokens mapped to a scoped principal. ~150–250 lines + 3
  routes + a table. Credential never appears in a URL; revocation = delete the
  grant. Fits MANDATORY rule 3 (guard secrets — no credentials through logs).
- **Option B — capability URL with EXPLICIT risk acceptance:** ship faster;
  the URL IS a credential that lands in Vercel request logs forever and in
  Anthropic's connector store. Compensations (not mitigations): minimal scopes
  on the capability principal (board:read, capture:write, focus:*; card
  mutation only through the confirm gate), one-command rotation, instant
  revocation. Acceptable blast radius = one kanban board, but it is a
  documented standing leak.

Recommendation: **A.** The stub is small, single-principal, and the only option
consistent with the project's own secrets rule. B remains the documented
fallback if the stub fights the connector in practice.

## Slices

### 6.0 — connector probe (tiny, throwaway, FIRST)
A minimal `/api/mcp-probe` route: stateless JSON-RPC handling for
initialize/tools/list/one echo tool, logging method, Accept header, GET
attempts, and timing. Claire adds it as an unauthenticated connector ONCE (in
claude.ai AND opens it in Cowork); we read the logs and learn exactly what the
connector requires (JSON-vs-SSE tolerance, GET channel, timeout, schema
strictness, tool-count tolerance via a padded registry variant). The probe is
deleted afterwards. Every later decision (middleware vs hand-rolled, SSE
needed?) is then evidence-based, not SDK-client-inferred.

### 6.1 (PR 1) — durable confirmation gate, stdio-only
- Migration: `mcp_confirmations` (id, token_hash, user_id, tool, args jsonb,
  preview, created_at, expires_at, used_at) — service-role only.
- Both invariants from review verdict 2; single-use via atomic
  `UPDATE … SET used_at = now() WHERE token_hash = … AND used_at IS NULL`
  returning the row (the row enforces it, not memory).
- The EXISTING stdio server switches to it (in-process closures retire); CLI
  tests + a stdio smoke prove the contract unchanged (refuse reuse/expiry).
- Shared tool registry extraction lands here too (`cli/src/mcp-tools.ts`):
  name/schema/tier/handler consumed by the stdio server now, the hosted
  server next PR. Pure refactor + gate swap, independently shippable.

### 6.2 (PR 2) — transport + auth + harness
- `POST /api/mcp` route (+ whatever 6.0 proved necessary: GET handler /
  Accept negotiation / SSE shim), via @hono/mcp `enableJsonResponse: true`
  unless the probe says otherwise; stateless per-request.
- Auth per the decision above (A: OAuth stub routes + grants table;
  B: `mcp_capabilities` + `scripts/mcp-capability.sh`).
- Hosted server instantiates the shared registry with: in-process readers for
  previews/validation, FocusboardClient (scoped principal) for writes.
- ROUTE_SCOPES entries (INLINE_AUTH for the MCP route — auth resolves
  in-handler before any dispatch; exact `:param` naming matters to the CI
  completeness test).
- Adapter check from review (Content-Type survival through the rewrite) is a
  pinned smoke path.
- CI: an MCP SDK-client round-trip (initialize → tools/list → today →
  batch-move plan → confirm → per-card results) as the smoke gate's E2E_CMD,
  on the smoke account's credential.
- Acceptance: Cowork session works (capture / today / shutdown / confirmed
  batch-move — Claire's one glance); confirm refuses reuse, expiry, and
  cross-principal tokens; revocation immediate; stdio behaviour unchanged.

## Non-goals
- Multi-user OAuth (the stub is single-principal by design).
- SSE server-push/resumability beyond what the probe proves necessary.
- New Vercel functions; Pro; replacing the stdio server (Claude Code keeps it).

## Review trail
- rev 1 reviewed by architect agent 2026-06-11: transport verified safe at the
  source level; capability-URL auth BLOCKED (credential-in-logs); gate-layer
  approved with two explicit invariants; reads-in-process correction; 2-PR
  split; own-table verdict; "SDK harness ≠ Cowork proof" honesty forced.
- rev 2 (this doc) incorporates all findings; auth posture left as the one
  decision for Claire with a recommendation.
