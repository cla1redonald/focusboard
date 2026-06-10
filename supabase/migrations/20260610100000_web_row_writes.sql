-- Phase 4b (step 1 of 2): the cards table becomes the system of record for cards.
--
-- Before this migration, external mutations (fb_add_card / fb_mutate_card)
-- edited the app_state BLOB and a trigger projected blob → rows. From here:
--
--   - fb_add_card / fb_mutate_card write the cards TABLE directly and bump the
--     per-card version themselves (the trigger no longer does it for them).
--   - The blob→rows trigger becomes conditional: it only projects when the blob
--     actually carries a 'cards' key. The NEW web client saves the blob with the
--     cards key stripped (cards go to rows), so its saves are no-ops here; OLD
--     web clients (pre-deploy tabs) still carry cards in the blob and keep the
--     mirror in sync during the rollout window. This makes the migration safe to
--     apply BEFORE the web deploy, with no edit-freeze required.
--   - cards joins the realtime publication: the web subscribes to per-card
--     INSERT/UPDATE/DELETE instead of full-blob app_state updates for cards.
--
-- Step 2 (a later cleanup migration, after the deploy is runtime-verified):
-- drop the trigger entirely and strip the stale 'cards' array from app_state.

-- ── fb_add_card: direct row insert ─────────────────────────────────────────────

create or replace function public.fb_add_card(p_user uuid, p_card jsonb)
returns jsonb
language plpgsql
security definer
as $$
begin
  -- A board = an app_state row (columns/settings live there). Card rows without
  -- a board would be invisible to every consumer, so keep the 4a contract.
  if not exists (select 1 from public.app_state where user_id = p_user) then
    raise exception 'BOARD_NOT_FOUND';
  end if;

  insert into public.cards (user_id, id, card_json)
  values (p_user, p_card->>'id', p_card);

  return p_card;
end;
$$;

-- ── fb_mutate_card: per-row compare-and-swap ───────────────────────────────────

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
  v_card jsonb;
  v_version bigint;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select card_json, version into v_card, v_version
  from public.cards
  where user_id = p_user and id = p_card_id
  for update;
  if not found then
    raise exception 'CARD_NOT_FOUND';
  end if;

  if p_expected_version is not null and v_version is distinct from p_expected_version then
    raise exception 'STALE_STATE';
  end if;

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

  update public.cards
  set card_json  = v_card,
      version    = v_version + 1,
      updated_at = now()
  where user_id = p_user and id = p_card_id;

  return v_card;
end;
$$;

-- ── Blob → rows projection: only when the blob still carries cards ─────────────

create or replace function public.sync_cards_from_app_state()
returns trigger
language plpgsql
security definer
as $$
begin
  -- The 4b web client strips the cards key from blob saves (rows are the
  -- source of truth). Projecting its card-less blob would DELETE every row,
  -- so: no cards key → not a card write → nothing to project.
  if not (new.state ? 'cards') then
    return new;
  end if;

  delete from public.cards c
  where c.user_id = new.user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(new.state->'cards', '[]'::jsonb)) e
      where e->>'id' = c.id
    );

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

-- ── Realtime: per-card change events for the web ───────────────────────────────
--
-- Replica identity stays DEFAULT (the primary key): DELETE events then carry
-- (user_id, id) in their old record — exactly what the web's delete handler
-- needs — without paying to ship the whole card_json on every delete.

do $$
begin
  alter publication supabase_realtime add table public.cards;
exception
  when duplicate_object then null;
end $$;
