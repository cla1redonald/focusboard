#!/usr/bin/env bash
# detect-secrets.test.sh — self-test for detect-secrets.sh.
#
# Run:  bash gates/detect-secrets.test.sh
# Exits non-zero if any case fails, so CI can run it directly.
#
# The regression case is the shape that actually escaped this gate: a 64-hex
# credential inside an escaped-JSON body in a shell command. The old key/value
# pattern required the separator to follow the key name directly, so the
# intervening \" defeated it, and there was no entropy check to catch the value
# on its own.

set -uo pipefail

GATE="$(cd "$(dirname "$0")" && pwd)/detect-secrets.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0

# expect_flag <name> <file>  — the file must be reported as containing a secret
expect_flag() {
  if bash "$GATE" --scan "$2" >/dev/null 2>&1; then
    printf '  FAIL  %s (expected a finding, got clean)\n' "$1"; fail=$((fail+1))
  else
    printf '  ok    %s\n' "$1"; pass=$((pass+1))
  fi
}

# expect_clean <name> <file> — the file must come back clean
expect_clean() {
  if bash "$GATE" --scan "$2" >/dev/null 2>&1; then
    printf '  ok    %s\n' "$1"; pass=$((pass+1))
  else
    printf '  FAIL  %s (expected clean, got a finding)\n' "$1"; fail=$((fail+1))
  fi
}

# --- fixtures. Values are assembled at runtime so this file holds no literal
# --- credential of its own.
# Split so this file contains no 32+ char hex run of its own; the scanner is
# supposed to flag those, and it should stay honest about its own source.
HEX="$(printf '%s%s%s' 'a0e9c519d5464330ef25' '70e4c546aee22f5f651d' 'ff1732265350e51372dc40b5')"

printf '  -d "{\\"content\\":$X,\\"secret\\":\\"%s\\"}"\n' "$HEX" > "$TMP/escaped-json.sh"
printf 'WEBHOOK=%s\n' "$HEX" > "$TMP/bare-assignment.sh"
printf 'const k = "AKIA%s";\n' 'ABCDEFGHIJKLMNOP' > "$TMP/aws.ts"

{ printf 'SECRET_VALUE="$(cat "$HOME/.config/app/secret")"\n'
  printf 'curl -d "{\\"secret\\":\\"${SECRET_VALUE}\\"}"\n'; } > "$TMP/indirect.sh"

{ printf 'Fixed in commit a6a572f08e2aa03c886f96a245bf5eee6c3e9cbd.\n'
  printf 'integrity sha512-Zv7Kc8Xh3JqLmN0pQrStUvWxYz1234567890abcdefABCDEF==\n'; } > "$TMP/shas.md"

{ printf 'ANTHROPIC_API%s=your_anthropic_key_here\n' '_KEY'
  printf 'SLACK_BOT%s=xoxb-your-bot-token\n' '_TOKEN'; } > "$TMP/placeholders.env"

{ printf 'const t = process.env.UPSTASH_REDIS_REST_TOKEN;\n'
  printf 'const confirmToken = args.confirm_token as string;\n'
  printf 'const uuid = "550e8400e29b41d4a716446655440000"; // uuid\n'; } > "$TMP/code.ts"

echo "detect-secrets self-test"
echo "must flag:"
expect_flag "credential in escaped JSON (the regression)" "$TMP/escaped-json.sh"
expect_flag "credential in a bare assignment"             "$TMP/bare-assignment.sh"
expect_flag "AWS access key ID"                           "$TMP/aws.ts"

echo "must stay clean:"
expect_clean "secret read from a local file"     "$TMP/indirect.sh"
expect_clean "commit SHAs and integrity hashes"  "$TMP/shas.md"
expect_clean "placeholder env values"            "$TMP/placeholders.env"
expect_clean "env refs, property access, uuid"   "$TMP/code.ts"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
