-- Phase 4b (step 2 of 2): retire the blob's cards array.
--
-- ⚠ Apply ONLY after the 4b web deploy is live and runtime-verified (two-tab
-- browser pass + CLI mutating alongside). Until every open tab runs the 4b
-- client, old tabs still save blobs WITH a cards array and rely on the
-- conditional trigger to keep the mirror in sync; dropping the trigger early
-- would let such a tab's blob saves silently diverge from the rows.
--
-- After this migration the cards table is the ONLY home of cards: the trigger
-- is gone (the web writes rows directly) and existing blobs lose their stale
-- legacy cards array.

drop trigger if exists app_state_sync_cards on public.app_state;
drop function if exists public.sync_cards_from_app_state();

-- Strip the legacy cards array from every blob. Readers already ignore it
-- (web + API take cards from rows), so this is pure cleanup — it also shrinks
-- app_state realtime payloads down to actual non-card state.
update public.app_state
set state = state - 'cards'
where state ? 'cards';
