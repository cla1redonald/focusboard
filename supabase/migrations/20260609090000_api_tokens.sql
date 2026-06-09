-- Personal Access Tokens (PAT) for the CLI + MCP operating layer.
-- The CLI/MCP authenticate with `Authorization: Bearer fb_pat_...`. We store ONLY the
-- SHA-256 hash of the token — the plaintext is shown once at creation and never again.
-- Per-token scopes gate what a token may do (capture-only now; card:write later).
-- The web settings page manages a user's own tokens via their session (RLS below);
-- the API resolver looks tokens up by hash with the service-role key (bypasses RLS).

create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  name         text not null,
  scopes       text[] not null default array['capture:read', 'capture:write'],
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists api_tokens_token_hash_idx on public.api_tokens (token_hash);
create index if not exists api_tokens_user_id_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;

-- A user can see and manage only their own tokens. token_hash is never sent to the
-- client by the app (the settings UI selects id/name/scopes/timestamps only).
create policy "api_tokens_select_own" on public.api_tokens
  for select using (auth.uid() = user_id);
create policy "api_tokens_insert_own" on public.api_tokens
  for insert with check (auth.uid() = user_id);
create policy "api_tokens_update_own" on public.api_tokens
  for update using (auth.uid() = user_id);
create policy "api_tokens_delete_own" on public.api_tokens
  for delete using (auth.uid() = user_id);

-- Idempotency for capture: a CLI/MCP retry with the same key must not double-insert.
alter table public.capture_queue add column if not exists idempotency_key text;
create unique index if not exists capture_queue_idem_idx
  on public.capture_queue (user_id, idempotency_key)
  where idempotency_key is not null;
