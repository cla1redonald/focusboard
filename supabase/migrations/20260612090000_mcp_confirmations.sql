-- Phase 6.1: durable MCP confirmation gate
--
-- Moves the Tier-3 confirmation gate from the stdio process's in-memory Map
-- to a durable server-side table so a stateless hosted MCP server can use the
-- identical gate in a future phase.
--
-- Design notes:
--   - Tokens are stored as sha256 hashes (never the plaintext).
--   - RLS is enabled but NO user policies — service-role only.
--   - The atomic claim (UPDATE … WHERE used_at IS NULL AND expires_at > now()
--     AND user_id = <principal>) is the single-use + cross-principal guard.
--   - Expired rows can be pruned on a schedule; the NOT NULL user_id + on delete
--     cascade cleans up on user deletion.
--
-- NOT APPLIED by CI — applied manually per the migration policy in HANDOFF.md.

create table if not exists public.mcp_confirmations (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token_hash  text        not null unique,
  tool        text        not null,
  args        jsonb       not null,
  preview     text        not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

alter table public.mcp_confirmations enable row level security;

-- Service-role only — no user-facing policies.
-- Agents never touch Supabase directly; they go through the API layer which uses
-- the service-role key. A future hosted-MCP endpoint inherits the same contract.
