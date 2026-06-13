#!/usr/bin/env bash
# check-docs-coverage.sh — CONTENT-coverage docs gate (zero-cost, no LLM).
#
# WHY THIS EXISTS (the FocusBoard drift incident):
#   The sibling gate check-docs-sync.sh is a TOUCH gate: "code changed → SOME doc
#   must change too." That is satisfied by editing ANY doc — HISTORY.md, an
#   unrelated docs/FOO.md — so a PR that adds 10 API routes and edits HISTORY.md
#   PASSES while docs/API.md never gets the new routes. FocusBoard shipped Phases
#   3–6 (focus sessions, card mutation, agent workflows, hosted MCP + OAuth) this
#   way: docs/API.md documented ~4 of ~30 routes and docs/SUPABASE.md ~25% of the
#   schema, every PR green. The touch gate can't see WHAT was documented, only THAT
#   something was. This gate closes that gap.
#
# WHAT IT DOES:
#   For each "manifest" (an authoritative source of truth) it extracts a set of
#   NAMES and asserts each name appears (as a literal substring) in the designated
#   doc file. A name present in source but absent from the doc = drift = FAIL, with
#   the exact missing names printed. Pure grep/sed — runs in seconds, no token cost.
#
#   Built-in manifests (auto-skipped if the source path doesn't exist, so this is
#   safe to run on any repo):
#     ROUTES  — "METHOD /path" keys from an API route table  → must appear in docs/API.md
#     DB      — table + function names from supabase/migrations/*.sql → docs/SUPABASE.md
#
# OVERRIDE: put [no-docs] in any commit message in the range to bypass (parity with
#   check-docs-sync.sh) — e.g. a pure-refactor PR that renames nothing user-facing.
#
# CONFIG (override the defaults via env to fit an unusual layout):
#   SHIPIT_ROUTES_SRC   file the route manifest is grepped from
#                       (default: api/_lib/auth-middleware.ts — the ROUTE_SCOPES map)
#   SHIPIT_ROUTES_DOC   doc that must mention every route   (default: docs/API.md)
#   SHIPIT_ROUTES_RE    ERE capturing "METHOD /path" route keys
#   SHIPIT_DB_GLOB      migrations glob                     (default: supabase/migrations/*.sql)
#   SHIPIT_DB_DOC       doc that must mention every table/fn (default: docs/SUPABASE.md)
#
# Usage:
#   gates/check-docs-coverage.sh           # check current working tree (CI + local)
#   SHIPIT_DOCS_COVERAGE_BASE=origin/main \
#     gates/check-docs-coverage.sh         # also honour [no-docs] across the PR range

set -uo pipefail

ROUTES_SRC="${SHIPIT_ROUTES_SRC:-api/_lib/auth-middleware.ts}"
ROUTES_DOC="${SHIPIT_ROUTES_DOC:-docs/API.md}"
# Matches the ROUTE_SCOPES keys: "GET /api/cards/:id", "POST /api/oauth/token", …
ROUTES_RE="${SHIPIT_ROUTES_RE:-(GET|POST|PUT|PATCH|DELETE)[[:space:]]+/api/[A-Za-z0-9/:_.-]+}"
DB_GLOB="${SHIPIT_DB_GLOB:-supabase/migrations/*.sql}"
DB_DOC="${SHIPIT_DB_DOC:-docs/SUPABASE.md}"

# ── [no-docs] override (range mode only — needs a base ref to read commit msgs) ──
base="${SHIPIT_DOCS_COVERAGE_BASE:-}"
if [ -n "$base" ]; then
  msg=$(git log --format='%B' "${base}..HEAD" 2>/dev/null || true)
  if printf '%s\n' "$msg" | grep -qi '\[no-docs\]'; then
    echo "docs-coverage: [no-docs] override present — skipping."
    exit 0
  fi
fi

fail=0

# Print every name in $2.. (newline list, arg $1=label) that is NOT a substring of
# the doc file $doc. Returns 1 if any are missing.
report_missing() {
  local label="$1" doc="$2"; shift 2
  local names="$1"
  local missing=""
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    # Literal (-F) substring match — the doc may wrap the name in backticks, a
    # heading, a table cell; we only require the token is present SOMEWHERE.
    if ! grep -qF "$name" "$doc" 2>/dev/null; then
      missing="${missing}${name}"$'\n'
    fi
  done <<< "$names"

  if [ -n "$missing" ]; then
    echo "::error::$doc is missing $label that exist in source:"
    printf '%s' "$missing" | sed '/^$/d;s/^/  - /'
    echo "  Document each one in $doc, or add [no-docs] to a commit if it genuinely needs none."
    return 1
  fi
  echo "docs-coverage: $doc covers all $label OK"
  return 0
}

# ── ROUTES manifest → docs/API.md ───────────────────────────────────────────────
if [ -f "$ROUTES_SRC" ]; then
  # Extract "METHOD /api/path" tokens, normalise inner whitespace to one space, dedupe.
  routes=$(grep -hoE "$ROUTES_RE" "$ROUTES_SRC" 2>/dev/null \
            | sed -E 's/[[:space:]]+/ /g' | sort -u)
  if [ -n "$routes" ]; then
    if [ ! -f "$ROUTES_DOC" ]; then
      echo "::error::route manifest found in $ROUTES_SRC but $ROUTES_DOC does not exist."
      fail=1
    else
      report_missing "API routes" "$ROUTES_DOC" "$routes" || fail=1
    fi
  fi
fi

# ── DB manifest (tables + functions) → docs/SUPABASE.md ─────────────────────────
db_files=$(ls $DB_GLOB 2>/dev/null || true)
if [ -n "$db_files" ]; then
  # CREATE TABLE [IF NOT EXISTS] [schema.]name  → bare name
  tables=$(grep -rhioE 'create table (if not exists )?([a-z_]+\.)?[a-z_]+' $DB_GLOB 2>/dev/null \
            | sed -E 's/.*[[:space:]]([a-z_]+\.)?([a-z_]+)$/\2/I' | sort -u)
  # CREATE [OR REPLACE] FUNCTION [schema.]name  → bare name
  funcs=$(grep -rhioE 'create (or replace )?function ([a-z_]+\.)?[a-z_]+' $DB_GLOB 2>/dev/null \
            | sed -E 's/.*[[:space:]]([a-z_]+\.)?([a-z_]+)$/\2/I' | sort -u)
  db_objects=$(printf '%s\n%s\n' "$tables" "$funcs" | sed '/^$/d' | sort -u)
  if [ -n "$db_objects" ]; then
    if [ ! -f "$DB_DOC" ]; then
      echo "::error::DB migrations found but $DB_DOC does not exist."
      fail=1
    else
      report_missing "tables/functions" "$DB_DOC" "$db_objects" || fail=1
    fi
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "docs-coverage FAILED — the docs have drifted from the source of truth."
  echo "This is a CONTENT check (does the doc mention each route/table?), not a touch"
  echo "check — editing an unrelated doc will NOT satisfy it."
  exit 1
fi

echo "docs-coverage OK"
exit 0
