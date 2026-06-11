# Phase 6 — Hosted MCP Server

**Plan date:** 2026-06-11
**Status:** 6.1 built (branch phase6-1-durable-gate, awaiting migration + PR)

---

## Phase 6.1 — Durable confirmation gate (BUILT 2026-06-11)

**Goal:** move the Tier-3 confirmation gate from the stdio process's in-memory Map to
durable server-side state so a future stateless hosted MCP server can use the identical gate.
Ships stdio-only; contract unchanged for agents.

### What was built

**Migration** `supabase/migrations/20260612090000_mcp_confirmations.sql` — the
`mcp_confirmations` table (id, user_id, token_hash unique, tool, args jsonb, preview, created_at,
expires_at, used_at). RLS enabled, service-role only. NOT applied by CI; apply manually.

**API routes** in `api/_lib/hono-app.ts`:
- `POST /api/confirmations` — propose a Tier-3 op (validates tool allowlist + preview ≤2000 chars; stores sha256(token); returns `{ confirm_token, expires_in_seconds: 300, preview }`)
- `POST /api/confirmations/confirm` — atomic claim + in-process execute (UPDATE … WHERE used_at IS NULL AND expires_at > now() AND user_id = principal.userId; zero rows → 404 CONFIRM_NOT_FOUND)

Both routes require `card:write` scope (added to ROUTE_SCOPES).

**Executor** `api/_lib/confirm-executor.ts` — maps the allowlisted tool name to an in-process
`app.fetch()` dispatch. For move_card / done_card / update_card it reads a fresh version via
GET /api/cards/:id before the mutation (preserving the 4a CAS contract). The `app` reference
is passed in lazily (no circular init).

**Client methods** `cli/src/client.ts`: `confirmationCreate()` and `confirmationExecute()`.

**Tool registry** `cli/src/mcp-tools.ts` — all MCP tool definitions extracted from mcp.ts
into a typed registry (name, title, description, inputSchema, tier, handler). Tier-3 handlers
call `client.confirmationCreate()` and return `{ status: "confirmation_required", ... }`.
`focusboard_confirm` calls `client.confirmationExecute()`. The in-process `pendingOps` Map
is deleted.

**mcp.ts** — shrunk to: build server, registerTool over the registry, transport wiring.

**Tests** `api/_lib/confirmations.test.ts` (23 tests covering): scope enforcement, tool
allowlist, preview validation, expired/used/unknown token → 404, cross-user claim rejected,
single-use enforcement, add_card happy path, move_card fresh-version read, move_cards
batch dispatch, STALE_STATE propagation.

**Gates:** all green — typecheck, typecheck:api, test:api (128 tests), test:run (648 tests),
test:cli (21 tests), eslint.

### Security invariants

- `user_id` equality is part of the atomic claim — cross-principal tokens can never execute.
- Single-use enforced by the row update (not memory).
- Token stored as sha256 hash only; plaintext returned once, never persisted.
- Tool allowlist enforced at proposal time — unknown tools never get a token row.

### Review verdicts

- Architecture locked; no redesign during build.

---

## Phase 6.2 — Hosted MCP server (planned)

A stateless Vercel function (or Edge function) that implements the MCP protocol over HTTP,
using the same `POST /api/confirmations` + `POST /api/confirmations/confirm` gate. The MCP
tools registry from `cli/src/mcp-tools.ts` is reused; the stdio transport is replaced with
a stateless HTTP transport.

Pending design:
- Transport: SSE vs. streamable HTTP (per MCP spec 2025-03)
- Auth: same PAT model; FOCUSBOARD_TOKEN in the MCP client config
- Deployment: new Vercel function (within the 12-fn cap) or a route off the existing Hono app
