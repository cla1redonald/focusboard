#!/usr/bin/env bash
# specialist-nudge.sh — PreToolUse(Bash) reminder, NON-blocking.
#
# On a `git commit`, inspects the STAGED diff and, if it touches an architectural or a UI
# surface, nudges you to summon the matching @agent before shipping. It never blocks
# (exit 0) — like docs-sync-reminder.sh, it's the early prompt, not the wall.
#
# The agents ship WITH the plugin (agents/architect.md, agents/designer.md), so the nudge
# always points at a real, installed specialist. The single highest-value output of the
# first wild run was an ad-hoc specialist summon (the architect catching a half-aspirational
# API boundary) — this fires that pattern by itself instead of leaving it to memory.
#
# NOTE: the architect's biggest win is at PLAN time (summon before building), not just here
# at commit time. This commit-time nudge is the backstop for when that didn't happen.
#
# Installed per-repo by install-gates.sh (copied into .shipit-gates/, wired into
# .claude/settings.json PreToolUse).
set -uo pipefail
command -v jq >/dev/null 2>&1 || exit 0
cmd="$(cat | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
printf '%s' "$cmd" | grep -q 'git commit' || exit 0

staged="$(git diff --cached --name-only 2>/dev/null || true)"
[ -n "$staged" ] || exit 0

# Architectural surfaces: migrations, raw SQL, schema/data-model files, the API boundary.
arch="$(printf '%s\n' "$staged" | grep -Ei '(^|/)migrations/|\.sql$|(^|/)schema\.|(^|/)api/' || true)"
# A new dependency line added to a staged package.json (added `"name": "version"`).
if printf '%s\n' "$staged" | grep -q 'package\.json$'; then
  if git diff --cached -- '*package.json' 2>/dev/null \
       | grep -Eq '^\+[[:space:]]+"[^"]+"[[:space:]]*:[[:space:]]*"[^"]+"'; then
    arch="${arch}"$'\n'"package.json (new dependency)"
  fi
fi
# UI surfaces: components, TSX/JSX, CSS/SCSS (Tailwind), pages/routes.
ui="$(printf '%s\n' "$staged" | grep -Ei '(^|/)components/|\.(tsx|jsx)$|\.(css|scss)$|(^|/)(pages|app)/' || true)"

if [ -n "$arch" ]; then
  echo "specialist nudge: staged changes touch an architectural surface (migrations / *.sql / api/ / new deps) — summon @architect to review the design before shipping (best done at PLAN time, not just pre-merge)." >&2
fi
if [ -n "$ui" ]; then
  echo "specialist nudge: staged changes touch a UI surface (components / *.tsx / *.css) — summon @designer to review the user-facing change before shipping." >&2
fi
exit 0
