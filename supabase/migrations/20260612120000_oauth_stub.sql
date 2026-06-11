-- Phase 6.2: OAuth stub tables for single-principal MCP auth.
-- DO NOT APPLY via supabase db push — apply manually via the Supabase SQL editor or
-- the Management API.
--
-- Enables a minimal OAuth 2.1 Authorization Server (DCR + PKCE) that issues
-- short-lived access tokens scoped to Claire's Supabase user principal.
-- All three tables use service-role-only RLS (no user policies) — the Hono API
-- is the sole writer.

-- ── oauth_clients ─────────────────────────────────────────────────────────────
-- Stores Dynamic Client Registration (DCR) registrations (e.g. claude.ai connector).

create table if not exists oauth_clients (
  client_id    uuid        primary key default gen_random_uuid(),
  client_name  text,
  redirect_uris jsonb      not null,
  created_at   timestamptz default now()
);

alter table oauth_clients enable row level security;
-- No user policies: service-role only. Hono uses the service-role key exclusively.

-- ── oauth_codes ───────────────────────────────────────────────────────────────
-- Short-lived PKCE authorization codes (5-minute window, single-use via used_at).

create table if not exists oauth_codes (
  code_hash        text        primary key,
  client_id        uuid        not null references oauth_clients (client_id) on delete cascade,
  user_id          uuid        not null references auth.users (id) on delete cascade,
  redirect_uri     text        not null,
  code_challenge   text        not null,
  scope            text        not null,
  created_at       timestamptz default now(),
  expires_at       timestamptz not null,
  used_at          timestamptz
);

alter table oauth_codes enable row level security;
-- No user policies: service-role only.

-- ── oauth_tokens ──────────────────────────────────────────────────────────────
-- Access + refresh token pairs. Revoked via revoked_at; access expires via
-- access_expires_at. Refresh rotation: revoke old row, insert new pair.

create table if not exists oauth_tokens (
  id                  uuid        primary key default gen_random_uuid(),
  client_id           uuid        not null references oauth_clients (client_id) on delete cascade,
  user_id             uuid        not null references auth.users (id) on delete cascade,
  access_token_hash   text        not null unique,
  refresh_token_hash  text        not null unique,
  scope               text        not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz not null default now() + interval '30 days',
  created_at          timestamptz default now(),
  revoked_at          timestamptz
);

alter table oauth_tokens enable row level security;
-- No user policies: service-role only.

-- ── oauth_login_attempts ──────────────────────────────────────────────────────
-- Per-IP throttle for the credential form (POST /api/oauth/authorize), defense
-- in depth over Supabase Auth's own sign-in rate limit (OWASP A04/A07). One row
-- per POST; the handler counts rows for the IP in a short window and refuses
-- past a threshold. Prune old rows on a schedule (or by a TTL job).

create table if not exists oauth_login_attempts (
  id           uuid        primary key default gen_random_uuid(),
  ip           text        not null,
  attempted_at timestamptz not null default now()
);

create index if not exists oauth_login_attempts_ip_time_idx
  on oauth_login_attempts (ip, attempted_at);

alter table oauth_login_attempts enable row level security;
-- No user policies: service-role only.
