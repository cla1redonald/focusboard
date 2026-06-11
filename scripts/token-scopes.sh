#!/usr/bin/env bash
#
# token-scopes.sh — bump a user's non-revoked API tokens to the CURRENT full
# scope set. Kills the recurring "tokens minted before phase N lack the new
# scopes" foot-gun without a Settings-UI visit.
#
# Tokens are scope-frozen at mint (by design); every phase that adds scopes
# previously left existing tokens unable to call the new endpoints (the
# Phase-2 CLI token couldn't mutate cards in 4a, couldn't read focus history
# in 5a, …). Run this after any phase that adds scopes:
#
#   npm run token:scopes -- --email cla1re@me.com
#
# Prints which tokens were updated (id + name only — never token material).
# Requirements: supabase CLI logged in (project owner), jq, curl.

set -euo pipefail

PROJECT_REF="pqjzwyrhcqczplrubfqs"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
# Keep in sync with SCOPES in api/_lib/token.ts.
ALL_SCOPES='["capture:read","capture:write","board:read","focus:read","focus:write","card:write"]'

say() { printf '%s\n' "$*" >&2; }

EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2 ;;
    *) say "Unknown argument: $1 — usage: token-scopes.sh --email <user-email>"; exit 1 ;;
  esac
done
[ -n "$EMAIL" ] || { say "usage: token-scopes.sh --email <user-email>"; exit 1; }

command -v supabase >/dev/null || { say "supabase CLI required"; exit 1; }
command -v jq >/dev/null || { say "jq required"; exit 1; }

SRK=$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json 2>/dev/null \
  | jq -r '.[] | select(.name=="service_role") | .api_key')
[ -n "$SRK" ] && [ "$SRK" != "null" ] || { say "could not fetch service role key (supabase login?)"; exit 1; }

USER_ID=$(curl -sf "${SUPABASE_URL}/auth/v1/admin/users?per_page=200" \
  -H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" \
  | jq -r --arg e "$EMAIL" '.users[] | select(.email==$e) | .id' | head -1)
[ -n "$USER_ID" ] || { say "no auth user with email ${EMAIL}"; exit 1; }

UPDATED=$(curl -sf -X PATCH \
  "${SUPABASE_URL}/rest/v1/api_tokens?user_id=eq.${USER_ID}&revoked_at=is.null" \
  -H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"scopes\": ${ALL_SCOPES}}" \
  | jq -r '.[] | "  \(.id)  \(.name)"')

if [ -z "$UPDATED" ]; then
  say "no non-revoked tokens found for ${EMAIL} — nothing updated"
else
  say "updated to the current full scope set:"
  say "$UPDATED"
fi
