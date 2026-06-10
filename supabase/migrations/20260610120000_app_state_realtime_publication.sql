-- Phase 4b verification finding: app_state was NEVER in the supabase_realtime
-- publication (only capture_queue and, since 4b, cards were ever added), so
-- every postgres_changes subscription on it has been silently rejected by the
-- realtime server ("Unable to subscribe to changes with given parameters").
--
-- Consequences before this fix:
--   - The PRE-4b web app's board realtime sync never actually worked in prod
--     (its bare .subscribe() surfaced no error) — only capture-inbox realtime
--     (capture_queue) did. The 4a "residual race bounded by realtime
--     convergence" assumption was therefore false in practice.
--   - The 4b combined channel (app_state + cards bindings) was killed wholesale
--     by the failing app_state binding, so per-card events didn't flow either.
--
-- Fix: put app_state in the publication so non-card board state (settings,
-- columns, tags, daily plan) syncs as designed. The web code is ALSO hardened
-- in the same change: cards and app_state subscribe on separate channels (one
-- failing binding can no longer take down card sync) and subscription status
-- errors are logged instead of swallowed.

do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception
  when duplicate_object then null;
end $$;
