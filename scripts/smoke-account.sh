#!/usr/bin/env bash
#
# smoke-account.sh — ensure the dedicated FocusBoard smoke-test account exists.
#
# Creates/repairs everything verification needs WITHOUT touching Claire's
# account or credentials:
#   1. a Supabase auth user  focusboard-smoke@focusboard.invalid  (confirmed,
#      password generated once and stored locally, never printed)
#   2. an API token for that user with ALL scopes (minted directly into
#      api_tokens as the smoke user — plaintext stored locally, never printed)
#   3. local credentials file  ~/.config/focusboard/smoke-credentials.json (0600)
#
# The smoke user's BOARD is deliberately not seeded here: the first Playwright
# sign-in creates it through the app's own new-user path, which is itself part
# of what verification should cover.
#
# Idempotent: safe to re-run after every phase that adds scopes (it re-mints
# the token with the current full scope set and revokes prior smoke tokens).
#
# Requirements: supabase CLI logged in (project owner), jq, node, curl.
# Optional: --gh-secret also writes the token to the GitHub Actions secret
#           FOCUSBOARD_SMOKE_TOKEN (requires gh CLI).
#
# Usage:  bash scripts/smoke-account.sh [--gh-secret]

set -euo pipefail

PROJECT_REF="pqjzwyrhcqczplrubfqs"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
SMOKE_EMAIL="focusboard-smoke@focusboard.invalid"
CREDS_FILE="${HOME}/.config/focusboard/smoke-credentials.json"
ALL_SCOPES='["capture:read","capture:write","board:read","focus:read","focus:write","card:write"]'

say() { printf '%s\n' "$*" >&2; }

command -v supabase >/dev/null || { say "supabase CLI required"; exit 1; }
command -v jq >/dev/null || { say "jq required"; exit 1; }
command -v node >/dev/null || { say "node required"; exit 1; }

SRK=$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json 2>/dev/null \
  | jq -r '.[] | select(.name=="service_role") | .api_key')
[ -n "$SRK" ] && [ "$SRK" != "null" ] || { say "could not fetch service role key (supabase login?)"; exit 1; }

auth_admin() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  curl -sf -X "$method" "${SUPABASE_URL}/auth/v1/admin${path}" \
    -H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" \
    -H "Content-Type: application/json" ${body:+-d "$body"}
}

# ── 1. Ensure the auth user ────────────────────────────────────────────────────

USER_ID=$(auth_admin GET "/users?per_page=200" \
  | jq -r --arg e "$SMOKE_EMAIL" '.users[] | select(.email==$e) | .id' | head -1)

PASSWORD=""
if [ -z "$USER_ID" ]; then
  PASSWORD=$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')
  USER_ID=$(auth_admin POST "/users" "$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$PASSWORD" \
    '{email: $e, password: $p, email_confirm: true, user_metadata: {purpose: "smoke-test account (Claude/CI verification)"}}')" \
    | jq -r '.id')
  [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] || { say "user creation failed"; exit 1; }
  say "created smoke user ${USER_ID}"
else
  say "smoke user exists: ${USER_ID}"
fi

# ── 2. Mint a fresh all-scopes token (revoke previous smoke tokens) ────────────

TOKEN=$(node -e 'console.log("fb_pat_" + require("crypto").randomBytes(32).toString("base64url"))')
HASH=$(node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$TOKEN")

# PostgREST with the service key bypasses RLS — rows belong to the smoke user only.
curl -sf -X PATCH "${SUPABASE_URL}/rest/v1/api_tokens?user_id=eq.${USER_ID}&revoked_at=is.null" \
  -H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" -H "Content-Type: application/json" \
  -d "{\"revoked_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

curl -sf -X POST "${SUPABASE_URL}/rest/v1/api_tokens" \
  -H "apikey: ${SRK}" -H "Authorization: Bearer ${SRK}" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "$(jq -nc --arg u "$USER_ID" --arg h "$HASH" --argjson s "$ALL_SCOPES" \
    '{user_id: $u, token_hash: $h, name: "smoke (script-minted)", scopes: $s}')"
say "minted fresh smoke token (all scopes)"

# ── 3. Store credentials locally (0600; password kept only if newly generated) ─

umask 077
mkdir -p "$(dirname "$CREDS_FILE")"
EXISTING_PW=""
[ -f "$CREDS_FILE" ] && EXISTING_PW=$(jq -r '.password // empty' "$CREDS_FILE" 2>/dev/null || true)
jq -nc --arg e "$SMOKE_EMAIL" --arg u "$USER_ID" --arg t "$TOKEN" --arg p "${PASSWORD:-$EXISTING_PW}" \
  '{email: $e, user_id: $u, token: $t} + (if $p != "" then {password: $p} else {} end)' > "$CREDS_FILE"
say "credentials written to ${CREDS_FILE}"

# ── 4. Optional: sync the GitHub Actions secret for the CI smoke gate ──────────

if [ "${1:-}" = "--gh-secret" ]; then
  command -v gh >/dev/null || { say "gh CLI required for --gh-secret"; exit 1; }
  # NB: no --body flag — `--body -` stores the LITERAL string "-" (gh reads
  # stdin only when --body is absent). This bug shipped a Bearer "-" to CI once.
  printf '%s' "$TOKEN" | gh secret set FOCUSBOARD_SMOKE_TOKEN --repo cla1redonald/focusboard
  say "GitHub secret FOCUSBOARD_SMOKE_TOKEN updated"
  # Email + password for the real-browser OAuth smoke (scripts/oauth-smoke.mjs).
  # Read the password back from the creds file (the run may not have generated one).
  SMOKE_PW=$(jq -r '.password // empty' "$CREDS_FILE")
  printf '%s' "$SMOKE_EMAIL" | gh secret set FOCUSBOARD_SMOKE_EMAIL --repo cla1redonald/focusboard
  if [ -n "$SMOKE_PW" ]; then
    printf '%s' "$SMOKE_PW" | gh secret set FOCUSBOARD_SMOKE_PASSWORD --repo cla1redonald/focusboard
    say "GitHub secrets FOCUSBOARD_SMOKE_EMAIL + FOCUSBOARD_SMOKE_PASSWORD updated"
  else
    say "WARNING: no smoke password in ${CREDS_FILE} — FOCUSBOARD_SMOKE_PASSWORD not set (the OAuth smoke needs it)"
  fi
fi

say "done — verification can now run as ${SMOKE_EMAIL} (token in ${CREDS_FILE})"
