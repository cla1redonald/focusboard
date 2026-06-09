-- Phase 3: extract focus sessions out of the metrics blob into an append-only,
-- event-shaped table — the same de-risking move capture_queue made for Phase 1.
--
-- Why: focus history lived inside the metrics JSONB blob (one row per user,
-- blind full-document upserts → last-writer-wins). Start/stop from the CLI/MCP
-- would have been blob mutations with the Phase-4 concurrency hazard. As rows:
-- inserts are append-only, stop is a single-row update, and an active session
-- is simply a row with ended_at IS NULL — which also gives the CLI something
-- the web never had: a PERSISTED in-progress session.

create table if not exists public.focus_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  card_id         text,
  card_title      text,
  planned_minutes int not null default 25 check (planned_minutes between 1 and 480),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  outcome         text check (outcome in ('progressed', 'blocked', 'completed', 'abandoned')),
  note            text,
  source          text not null default 'web',
  created_at      timestamptz not null default now(),
  -- a closed session has an outcome; an open one has neither end nor outcome
  constraint focus_sessions_closed_shape check (
    (ended_at is null and outcome is null) or (ended_at is not null and outcome is not null)
  )
);

-- ONE active session per user — enforced by the database, not application code.
create unique index if not exists focus_sessions_one_active_idx
  on public.focus_sessions (user_id)
  where ended_at is null;

create index if not exists focus_sessions_user_started_idx
  on public.focus_sessions (user_id, started_at desc);

alter table public.focus_sessions enable row level security;

create policy "focus_sessions_select_own" on public.focus_sessions
  for select using (auth.uid() = user_id);
create policy "focus_sessions_insert_own" on public.focus_sessions
  for insert with check (auth.uid() = user_id);
create policy "focus_sessions_update_own" on public.focus_sessions
  for update using (auth.uid() = user_id);
create policy "focus_sessions_delete_own" on public.focus_sessions
  for delete using (auth.uid() = user_id);

-- Backfill history from the metrics blob (completed sessions only — the blob
-- never stored active ones). Legacy session ids that aren't UUIDs (the old
-- `${cardId}-${endedAt}` fallback) get fresh ids. Idempotent via ON CONFLICT.
insert into public.focus_sessions
  (id, user_id, card_id, card_title, planned_minutes, started_at, ended_at, outcome, note, source)
select
  case
    when s->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (s->>'id')::uuid
    else gen_random_uuid()
  end,
  m.user_id,
  s->>'cardId',
  s->>'cardTitle',
  coalesce(nullif(s->>'plannedMinutes', '')::int, 25),
  (s->>'startedAt')::timestamptz,
  (s->>'endedAt')::timestamptz,
  case when s->>'outcome' in ('progressed','blocked','completed','abandoned')
       then s->>'outcome' else 'progressed' end,
  nullif(s->>'note', ''),
  'web'
from public.metrics m,
     jsonb_array_elements(m.metrics->'focusSessions') s
where jsonb_typeof(m.metrics->'focusSessions') = 'array'
  and s->>'startedAt' is not null
  and s->>'endedAt' is not null
on conflict (id) do nothing;
