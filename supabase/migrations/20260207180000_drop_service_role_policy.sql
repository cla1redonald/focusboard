-- Security fix: remove overly permissive RLS policy.
-- Service role key bypasses RLS automatically; the USING(true) policy
-- was nullifying user-scoped isolation for anon/authenticated roles.
DROP POLICY IF EXISTS "Service role full access" ON capture_queue;
