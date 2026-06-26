/**
 * ai-smoke.mjs — post-deploy smoke for the AUTHENTICATED AI endpoints.
 *
 * The gap this closes: the existing runtime-smoke checks /api/ai/* only
 * UNauthenticated (401), which fires before the model/key are ever touched — so
 * the June 2026 outage (every AI endpoint 500'd on a dead model) sailed through
 * every gate. This logs in for real (a Supabase session token via the auth API —
 * the SAME credential the web app sends), calls a real AI endpoint, and asserts
 * 200. A dead model (→500), an unfunded/!invalid key (→401/billing), or a down
 * endpoint (→404/504) all fail this.
 *
 * Run:
 *   SHIPIT_DEPLOY_URL=https://… FOCUSBOARD_SMOKE_EMAIL=… FOCUSBOARD_SMOKE_PASSWORD=… \
 *   SUPABASE_URL=https://….supabase.co SUPABASE_ANON_KEY=… node scripts/ai-smoke.mjs
 *   # Locally, missing values fall back to .env.local + the smoke-credentials file.
 *
 * Exit 0 = an authed AI call returns 200 on the deployed artifact; non-zero +
 * a clear line = the rung that broke (auth, endpoint, or the model/key chain).
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const BASE = (process.env.SHIPIT_DEPLOY_URL || process.env.BASE_URL || process.argv[2] || "").replace(/\/+$/, "");

function fail(msg) { console.error(`ai-smoke: FAIL — ${msg}`); process.exit(1); }
function ok(msg) { console.log(`ai-smoke: ${msg}`); }
// Missing config = this rung is not configured yet → SKIP (exit 0), like the
// other optional smoke rungs. Only a real smoke failure exits non-zero.
function skip(msg) { console.log(`ai-smoke: SKIP — ${msg}`); process.exit(0); }

// Fill missing config from .env.local (local runs); CI provides them as env.
function fromEnvLocal(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env.local")) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = readFileSync(".env.local", "utf8").match(new RegExp(`^${escaped}=(.*)$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : undefined;
}

if (!BASE) fail("No deploy URL — set SHIPIT_DEPLOY_URL or pass it as argv[1].");

const supabaseUrl = (process.env.SUPABASE_URL || fromEnvLocal("VITE_SUPABASE_URL") || fromEnvLocal("SUPABASE_URL") || "").replace(/\/+$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY || fromEnvLocal("VITE_SUPABASE_ANON_KEY") || fromEnvLocal("SUPABASE_ANON_KEY");
if (!supabaseUrl || !anonKey) skip("no Supabase URL / anon key (set SUPABASE_URL + SUPABASE_ANON_KEY in CI) — authed AI rung not configured.");

// Credentials: env first (CI secrets), then the local smoke creds file.
let email = process.env.FOCUSBOARD_SMOKE_EMAIL;
let password = process.env.FOCUSBOARD_SMOKE_PASSWORD;
if (!email || !password) {
  try {
    const c = JSON.parse(readFileSync(`${homedir()}/.config/focusboard/smoke-credentials.json`, "utf8"));
    email ||= c.email; password ||= c.password;
  } catch { /* fall through */ }
}
if (!email || !password) skip("no smoke credentials (FOCUSBOARD_SMOKE_EMAIL/PASSWORD) — authed AI rung not configured.");

const main = async () => {
  // 1. Real session token from the Supabase auth API — the exact credential the
  //    web app's useAI sends as `Authorization: Bearer <access_token>`.
  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  const authJson = await auth.json().catch(() => ({}));
  if (auth.status !== 200 || !authJson.access_token) {
    // A 401 here means the smoke ACCOUNT/secret is stale, not the code under test —
    // it's a hard block by design (a CI gate must fail loudly), so the on-call fix
    // is to rotate FOCUSBOARD_SMOKE_PASSWORD, not to touch the deploy.
    fail(`Supabase login failed (${auth.status}): ${authJson.error_description || authJson.message || JSON.stringify(authJson)}`);
  }
  ok("Supabase session token acquired ✓");

  // 2. Hit the cheapest AI endpoint (parse-card, Haiku) with that token.
  const res = await fetch(`${BASE}/api/ai/parse-card`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${authJson.access_token}` },
    body: JSON.stringify({
      input: "ci ai-smoke: prep the deck tomorrow",
      availableColumns: [{ id: "backlog", title: "Backlog" }, { id: "todo", title: "To Do" }],
      availableTags: [],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 401) fail("AI endpoint returned 401 — the session token was rejected (auth/verifySession regression).");
  if (res.status >= 500) {
    const body = await res.text().catch(() => "");
    fail(`AI endpoint returned ${res.status} — the model/key chain is broken (dead model, bad/unfunded key). Body: ${body.slice(0, 200)}`);
  }
  if (res.status !== 200) fail(`AI endpoint returned ${res.status} (expected 200).`);

  const json = await res.json().catch(() => ({}));
  if (!json?.card?.title) fail(`AI endpoint 200 but returned no parsed card: ${JSON.stringify(json).slice(0, 200)}`);

  ok(`authed /api/ai/parse-card → 200, parsed "${json.card.title}" ✓`);
  ok("PASS — a real session token drives a real AI endpoint to 200 on the deployed artifact.");
};

main().catch((e) => fail(e?.message || String(e)));
