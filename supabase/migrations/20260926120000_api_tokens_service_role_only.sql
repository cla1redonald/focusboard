-- Lock down api_tokens to service-role only.
--
-- Token mint/revoke/list already go through the Hono API (SESSION_ONLY routes
-- using the service-role key). The earlier own-row RLS policies let any
-- browser session with the anon key + JWT bypass that layer via PostgREST:
--   - INSERT a row with a chosen token_hash → mint a PAT without /api/tokens
--   - UPDATE scopes / clear revoked_at → escalate or un-revoke a soft-revoked PAT
--   - SELECT * → read token_hash values (not crackable for high-entropy PATs,
--     but unnecessary exposure)
--
-- Match oauth_* / mcp_confirmations: RLS on, zero user policies.

drop policy if exists "api_tokens_select_own" on public.api_tokens;
drop policy if exists "api_tokens_insert_own" on public.api_tokens;
drop policy if exists "api_tokens_update_own" on public.api_tokens;
drop policy if exists "api_tokens_delete_own" on public.api_tokens;

-- RLS remains enabled from 20260609090000_api_tokens.sql; with no policies,
-- anon/authenticated cannot touch the table. service_role bypasses RLS.
