-- Phase 4a: the cards table — a trigger-maintained mirror of app_state's cards,
-- plus atomic mutation functions for external (CLI/MCP/API) card writes.
--
-- Design (4a of 2 stages):
--   - The web app keeps writing the app_state blob exactly as today (zero web
--     changes). A trigger projects state->'cards' into per-card rows on every
--     blob write, bumping a per-card VERSION only when that card's JSON changed.
--   - External mutations go through fb_add_card / fb_mutate_card: one
--     transaction, app_state row locked FOR UPDATE (serialized against other
--     mutations), per-card version compare-and-swap (raise STALE_STATE on
--     mismatch → API maps to 409). The function updates the BLOB; the trigger
--     refreshes the mirror; Supabase realtime on app_state delivers the change
--     to any open web tab through the app's existing IMPORT_STATE path.
--   - Stage 4b (follow-up) flips the web's own writes to per-card rows and
--     retires the blob's cards array. Until then the documented residual race
--     is the web's full-blob save clobbering an external mutation made in the
--     same sub-second window — unchanged from today's behaviour, now bounded
--     by realtime convergence.

create table if not exists public.cards (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  card_json  jsonb not null,
  column_id  text generated always as (card_json->>'column') stored,
  archived   boolean generated always as ((card_json ? 'archivedAt')) stored,
  version    bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists cards_user_column_idx on public.cards (user_id, column_id);

alter table public.cards enable row level security;

create policy "cards_select_own" on public.cards
  for select using (auth.uid() = user_id);
create policy "cards_insert_own" on public.cards
  for insert with check (auth.uid() = user_id);
create policy "cards_update_own" on public.cards
  for update using (auth.uid() = user_id);
create policy "cards_delete_own" on public.cards
  for delete using (auth.uid() = user_id);

-- ── Blob → rows projection ─────────────────────────────────────────────────────

create or replace function public.sync_cards_from_app_state()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Remove rows whose card no longer exists in the blob.
  delete from public.cards c
  where c.user_id = new.user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(new.state->'cards', '[]'::jsonb)) e
      where e->>'id' = c.id
    );

  -- Upsert every card; bump version ONLY when the card's JSON actually changed
  -- (a full-blob save that touched one card must not invalidate every other
  -- card's optimistic lock).
  insert into public.cards (user_id, id, card_json)
  select new.user_id, e->>'id', e
  from jsonb_array_elements(coalesce(new.state->'cards', '[]'::jsonb)) e
  where e->>'id' is not null
  on conflict (user_id, id) do update
    set card_json  = excluded.card_json,
        version    = public.cards.version + 1,
        updated_at = now()
    where public.cards.card_json is distinct from excluded.card_json;

  return new;
end;
$$;

drop trigger if exists app_state_sync_cards on public.app_state;
create trigger app_state_sync_cards
  after insert or update of state on public.app_state
  for each row execute function public.sync_cards_from_app_state();

-- ── External mutation functions ────────────────────────────────────────────────
-- Called with the service-role key (API layer owns auth + validation).

create or replace function public.fb_add_card(p_user uuid, p_card jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_state jsonb;
begin
  select state into v_state from public.app_state where user_id = p_user for update;
  if not found then
    raise exception 'BOARD_NOT_FOUND';
  end if;
  if v_state->'cards' is null or jsonb_typeof(v_state->'cards') <> 'array' then
    raise exception 'BOARD_NOT_FOUND';
  end if;

  update public.app_state
  set state = jsonb_set(v_state, '{cards}', (v_state->'cards') || jsonb_build_array(p_card)),
      updated_at = now()
  where user_id = p_user;

  return p_card;
end;
$$;

create or replace function public.fb_mutate_card(
  p_user uuid,
  p_card_id text,
  p_expected_version bigint,
  p_patch jsonb,
  p_move_to text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_state jsonb;
  v_cards jsonb;
  v_idx int := -1;
  v_card jsonb;
  v_version bigint;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  i int;
begin
  -- Lock the blob row first: serializes against other mutations AND against
  -- the trigger-driven mirror refresh from web saves.
  select state into v_state from public.app_state where user_id = p_user for update;
  if not found then
    raise exception 'BOARD_NOT_FOUND';
  end if;

  v_cards := coalesce(v_state->'cards', '[]'::jsonb);
  for i in 0 .. jsonb_array_length(v_cards) - 1 loop
    if v_cards->i->>'id' = p_card_id then
      v_idx := i;
      exit;
    end if;
  end loop;
  if v_idx = -1 then
    raise exception 'CARD_NOT_FOUND';
  end if;

  -- Optimistic lock against the mirror's per-card version.
  select version into v_version from public.cards
  where user_id = p_user and id = p_card_id;
  if p_expected_version is not null and v_version is distinct from p_expected_version then
    raise exception 'STALE_STATE';
  end if;

  v_card := v_cards->v_idx;

  if p_move_to is not null and p_move_to <> v_card->>'column' then
    v_card := v_card
      || jsonb_build_object('column', p_move_to)
      || jsonb_build_object(
           'columnHistory',
           coalesce(v_card->'columnHistory', '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
                  'from', v_card->>'column', 'to', p_move_to, 'at', v_now))
         );
  end if;

  v_card := v_card || coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('updatedAt', v_now);

  update public.app_state
  set state = jsonb_set(v_state, array['cards', v_idx::text], v_card),
      updated_at = now()
  where user_id = p_user;

  return v_card;
end;
$$;

-- ── Backfill the mirror from existing blobs ────────────────────────────────────

insert into public.cards (user_id, id, card_json)
select a.user_id, e->>'id', e
from public.app_state a,
     jsonb_array_elements(coalesce(a.state->'cards', '[]'::jsonb)) e
where e->>'id' is not null
on conflict (user_id, id) do nothing;
