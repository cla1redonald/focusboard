#!/usr/bin/env bash
# detect-secrets.sh — secret scanner, usable two ways.
#
#   detect-secrets.sh                  PostToolUse hook. Reads the hook JSON on
#                                      stdin, scans the file that was just
#                                      written, warns on stderr, always exits 0.
#
#   detect-secrets.sh --scan [PATH]    Scans a file, or every tracked file under
#                                      a directory (default: repo root). Prints
#                                      findings and exits 1 if any are found, so
#                                      it can be used as a pre-commit hook or a
#                                      CI step.
#
# The hook mode stays warn-only on purpose: blocking a write retroactively is
# disruptive, and the point is to surface the signal while the author is still
# looking. The scan mode is the blocking one, because by then the question is
# "is this about to reach a remote".
#
# Patterns detected:
#   * AWS access key IDs            (AKIA…)
#   * Private key PEM headers       (-----BEGIN … PRIVATE KEY-----)
#   * OpenAI-style keys             (sk-… with long value)
#   * GitHub personal access tokens (ghp_…)
#   * Bearer tokens in assignments  (Bearer <long-value>)
#   * High-signal key/value shapes  (API_KEY, SECRET, TOKEN, PASSWORD …), including
#                                   JSON and escaped-JSON forms such as \"secret\":\"…\"
#   * Bare high-entropy hex         (32+ hex chars not in a hash-like context)
#
# The last two exist because of a real miss. A 64-hex webhook credential sat in
# an Automator .wflow file as \"secret\":\"<64-hex>\" inside an escaped JSON body.
# The old key/value pattern required the separator to follow the key name
# directly (\s*[=:]), so the intervening \" defeated it, and there was no
# entropy check to catch the value on its own. It stayed on a public default
# branch for roughly eight months. See the self-test at the bottom.
#
# Skips binary files, lockfiles, test/spec fixtures, and reads at most MAX_BYTES
# per file to avoid spending time on huge generated files.

set -uo pipefail

MAX_BYTES=65536   # scan first 64 KB of any single file

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

# should_skip <path> — true for files where a match is noise, not signal.
should_skip() {
  case "$1" in
    *.png|*.jpg|*.jpeg|*.gif|*.ico|*.svg|*.webp|*.avif|\
    *.woff|*.woff2|*.ttf|*.otf|*.eot|\
    *.pdf|*.zip|*.gz|*.tgz|*.tar|*.bin|*.exe|*.so|*.dylib|*.wasm|*.mp4|*.mp3)
      return 0 ;;
  esac
  # Lockfiles and vendored trees are wall-to-wall content hashes.
  case "$1" in
    *package-lock.json|*pnpm-lock.yaml|*yarn.lock|*Cargo.lock|*poetry.lock|*composer.lock|*go.sum|*.lock)
      return 0 ;;
    */node_modules/*|*/.git/*|*/dist/*|*/build/*|*/.next/*|*.min.js|*.min.css|*.map)
      return 0 ;;
  esac
  # Dummy credentials are expected in tests and examples.
  case "$1" in
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|\
    *.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx|\
    *.test.sh|*.test.bash|*.spec.sh|\
    *__tests__*|*fixtures*|*.example|*.sample|*.template)
      return 0 ;;
  esac
  return 1
}

# scan_file <path> — prints one "  - <reason>" line per finding. Returns 0 if
# any finding was printed, 1 if the file came back clean.
scan_file() {
  local path="$1" content found
  found=0

  [ -f "$path" ] || return 1
  should_skip "$path" && return 1

  content="$(head -c "$MAX_BYTES" "$path" 2>/dev/null)" || return 1
  [ -n "$content" ] || return 1

  # Null bytes mean binary. grep -P is GNU-only; if absent this is a no-op and
  # the extension check above is what keeps binaries out.
  if printf '%s' "$content" | grep -qP '\x00' 2>/dev/null; then
    return 1
  fi

  if printf '%s' "$content" | grep -E 'AKIA[0-9A-Z]{16}' \
      | grep -Eiqv 'process\.env|import\.meta\.env|secrets\.|env\[|os\.environ|getenv|placeholder|example|changeme|change_me|dummy|fake|not[_-]?real|redacted|sample|your[_-]|[_-]here|xxxx|\$\{|<[A-Za-z]|\.\.\.|REPLACE|TODO|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]|as string|as const|new-password|current-password|webauthn'; then
    printf '  - AWS access key ID (AKIA…)\n'; found=1
  fi

  if printf '%s' "$content" | grep -Eq -- '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'; then
    printf '  - Private key PEM header\n'; found=1
  fi

  if printf '%s' "$content" | grep -E 'sk-[a-zA-Z0-9_-]{20,}' \
      | grep -Eiqv 'process\.env|import\.meta\.env|secrets\.|env\[|os\.environ|getenv|placeholder|example|changeme|change_me|dummy|fake|not[_-]?real|redacted|sample|your[_-]|[_-]here|xxxx|\$\{|<[A-Za-z]|\.\.\.|REPLACE|TODO|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]|as string|as const|new-password|current-password|webauthn'; then
    printf '  - OpenAI/Anthropic-style API key (sk-…)\n'; found=1
  fi

  if printf '%s' "$content" | grep -Eq '(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,}'; then
    printf '  - GitHub token\n'; found=1
  fi

  if printf '%s' "$content" | grep -Eq 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'; then
    printf '  - JWT (eyJ…)\n'; found=1
  fi

  if printf '%s' "$content" | grep -E 'xox[baprs]-[a-zA-Z0-9-]{10,}' \
      | grep -Eiqv 'process\.env|import\.meta\.env|secrets\.|env\[|os\.environ|getenv|placeholder|example|changeme|change_me|dummy|fake|not[_-]?real|redacted|sample|your[_-]|[_-]here|xxxx|\$\{|<[A-Za-z]|\.\.\.|REPLACE|TODO|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]|as string|as const|new-password|current-password|webauthn'; then
    printf '  - Slack token (xox…)\n'; found=1
  fi

  if printf '%s' "$content" | grep -Eq 'Bearer [a-zA-Z0-9._~+/-]{20,}'; then
    printf '  - Bearer token value\n'; found=1
  fi

  # High-signal key/value shapes. The optional (\\?["']) before and after the
  # separator is what makes this cover JSON ("secret": "…") and escaped JSON
  # inside a shell string (\"secret\":\"…\"), not just KEY=value.
  # Value-side filter: an env-var reference or an obvious placeholder is not a secret.
  if printf '%s' "$content" | grep -Ei '(API_KEY|API_SECRET|SECRET_KEY|AUTH_SECRET|APP_SECRET|CLIENT_SECRET|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|PASSWORD|PASSWD|SECRET)(\\?["'"'"'])?[[:space:]]*[=:][[:space:]]*(\\?["'"'"'])?[a-zA-Z0-9+/=_.-]{16,}' \
      | grep -Eiqv 'process\.env|import\.meta\.env|secrets\.|env\[|os\.environ|getenv|placeholder|example|changeme|change_me|dummy|fake|not[_-]?real|redacted|sample|your[_-]|[_-]here|xxxx|\$\{|<[A-Za-z]|\.\.\.|REPLACE|TODO|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$]|as string|as const|new-password|current-password|webauthn'; then
    printf '  - High-signal secret assignment (API_KEY/SECRET/TOKEN/PASSWORD)\n'; found=1
  fi

  # Bare high-entropy hex, 32+ chars. Catches a raw credential regardless of the
  # syntax around it. Lines that look like a checksum, commit SHA or similar are
  # excluded, which is where the false positives live.
  if printf '%s' "$content" \
      | grep -E '(^|[^0-9a-zA-Z])[0-9a-fA-F]{32,}([^0-9a-zA-Z]|$)' \
      | grep -Eiqv 'sha[0-9]|md5|integrity|checksum|digest|etag|commit|revision|blob|oid|fingerprint|hash|uuid|guid'; then
    printf '  - Bare high-entropy hex string (32+ chars)\n'; found=1
  fi

  [ "$found" -eq 1 ] && return 0 || return 1
}

# ---------------------------------------------------------------------------
# Mode: --scan (blocking; for pre-commit or CI)
# ---------------------------------------------------------------------------

if [ "${1:-}" = "--scan" ]; then
  target="${2:-.}"
  hits=0

  if [ -f "$target" ]; then
    files="$target"
  elif command -v git >/dev/null 2>&1 && git -C "$target" rev-parse --git-dir >/dev/null 2>&1; then
    files="$(git -C "$target" ls-files --full-name | sed "s|^|${target%/}/|")"
  else
    files="$(find "$target" -type f 2>/dev/null)"
  fi

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    out="$(scan_file "$f")" || continue
    printf 'FAIL [detect-secrets]: potential secret in %s\n' "$f" >&2
    printf '%s\n' "$out" >&2
    hits=$((hits + 1))
  done <<EOF
$files
EOF

  if [ "$hits" -gt 0 ]; then
    printf '\n%d file(s) flagged. Rotate anything real, then remove it.\n' "$hits" >&2
    exit 1
  fi
  printf 'detect-secrets: clean\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Mode: PostToolUse hook (warn-only; default)
# ---------------------------------------------------------------------------

input="$(cat)"

have_jq=1; command -v jq >/dev/null 2>&1 || have_jq=0

get() { # get <jq-path>
  [ "$have_jq" = 1 ] && printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null || true
}

file_path="$(get '.tool_input.file_path')"
[ -n "$file_path" ] || exit 0

file_path="${file_path/#\~/$HOME}"

if out="$(scan_file "$file_path")"; then
  printf 'WARNING [detect-secrets]: Potential secrets detected in %s\n' "$file_path" >&2
  printf '%s\n' "$out" >&2
  printf 'Review before committing. This is a warning, not a block.\n' >&2
fi

# Always exit 0 in hook mode — warn only, never block.
exit 0
