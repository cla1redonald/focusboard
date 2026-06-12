/**
 * oauth-smoke.mjs — REAL-BROWSER smoke for the OAuth sign-in flow.
 *
 * The bug class this exists to catch: CSP, cache headers, and form/redirect
 * navigation are enforced by the BROWSER, not the server. A Node test asserts
 * the response-header string but never its EFFECT — FocusBoard's OAuth login
 * was blocked in prod by its own `form-action 'self'` CSP (it polices the
 * form's cross-origin 302), and a stale cached page replayed an old CSP, and
 * NONE of it showed in curl e2e or 170+ route tests. This loads the page in
 * real Chromium, submits the login, and asserts the redirect actually fires
 * with a `code` — the only thing that experiences CSP/cache. Then it completes
 * the PKCE exchange and a hosted-MCP call to prove the whole chain end to end.
 *
 * Run:
 *   SHIPIT_DEPLOY_URL=https://… FOCUSBOARD_SMOKE_EMAIL=… FOCUSBOARD_SMOKE_PASSWORD=… node scripts/oauth-smoke.mjs
 * Local (reads ~/.config/focusboard/smoke-credentials.json if env unset):
 *   npm run smoke:oauth -- https://focusboard-claire-donalds-projects.vercel.app
 *
 * Exit 0 = the full browser→redirect→token→MCP chain works; non-zero + a clear
 * line = the specific rung that broke.
 */
import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const BASE = (
  process.env.SHIPIT_DEPLOY_URL ||
  process.env.BASE_URL ||
  process.argv[2] ||
  ""
).replace(/\/+$/, "");
if (!BASE) fail("No deploy URL — set SHIPIT_DEPLOY_URL or pass it as argv[1].");

// Credentials: env first (CI secrets), then the local smoke creds file.
let email = process.env.FOCUSBOARD_SMOKE_EMAIL;
let password = process.env.FOCUSBOARD_SMOKE_PASSWORD;
if (!email || !password) {
  try {
    const c = JSON.parse(readFileSync(`${homedir()}/.config/focusboard/smoke-credentials.json`, "utf8"));
    email ||= c.email;
    password ||= c.password;
  } catch { /* fall through to the check below */ }
}
if (!email || !password) {
  fail("No smoke credentials — set FOCUSBOARD_SMOKE_EMAIL/PASSWORD or populate ~/.config/focusboard/smoke-credentials.json (run npm run smoke:setup).");
}

function fail(msg) {
  console.error(`oauth-smoke: FAIL — ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`oauth-smoke: ${msg}`);
}

async function postForm(path, fields) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const main = async () => {
  // 1. DCR: register a client whose redirect_uri is on THIS deploy, so the
  // post-login redirect lands somewhere we can read the code from (vs claude.ai
  // which we don't control). Any registered, exact-match URI works.
  const redirectUri = `${BASE}/oauth-smoke-callback`;
  const reg = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "ci-oauth-smoke" }),
  });
  if (reg.status !== 201) fail(`DCR register returned ${reg.status} (expected 201)`);
  const clientId = (await reg.json()).client_id;
  if (!clientId) fail("DCR register returned no client_id");
  ok(`registered client ${String(clientId).slice(0, 8)}…`);

  // 2. PKCE pair.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const authorizeUrl =
    `${BASE}/api/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}` +
    `&code_challenge_method=S256&state=${state}&scope=${encodeURIComponent("capture:read board:read")}`;

  // 3. Real browser: load the sign-in page, submit, assert the redirect FIRES.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const cspViolations = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/content security policy|form-action|violates/i.test(t)) cspViolations.push(t);
  });

  let code = null;
  try {
    await page.goto(authorizeUrl, { waitUntil: "domcontentloaded" });
    if (!(await page.locator('input[name="email"]').count())) {
      fail("sign-in form did not render (no email field)");
    }
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);

    // The KEY assertion: clicking submit must navigate the browser to the
    // redirect_uri with a ?code=. A CSP form-action block, or a stale cached
    // page, makes this navigation never happen → waitForURL times out → fail.
    await Promise.all([
      page.waitForURL((url) => url.toString().startsWith(redirectUri) && url.toString().includes("code="), { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]).catch(() => {
      const why = cspViolations.length ? ` (CSP violation in console: ${cspViolations[0]})` : "";
      fail(`login did not redirect with a code — the browser never navigated to ${redirectUri}?code=…${why}`);
    });

    const landed = new URL(page.url());
    code = landed.searchParams.get("code");
    if (landed.searchParams.get("state") !== state) fail("state did not round-trip through the redirect");
    if (!code) fail("redirect fired but carried no code");
    if (cspViolations.length) fail(`CSP violation reported during login: ${cspViolations[0]}`);
    ok("real-browser login → redirect with code ✓ (no CSP block)");
  } finally {
    await browser.close();
  }

  // 4. Cache header guard (cheap, deterministic): the auth page must be no-store.
  const pageHead = await fetch(authorizeUrl, { redirect: "manual" });
  const cacheControl = pageHead.headers.get("cache-control") || "";
  if (!/no-store/.test(cacheControl)) {
    fail(`sign-in page is cacheable (Cache-Control: "${cacheControl}") — a stale page can replay an old CSP/hidden fields`);
  }
  const csp = pageHead.headers.get("content-security-policy") || "";
  if (/form-action/.test(csp)) {
    fail(`sign-in CSP sets form-action ("${csp}") — that blocks the OAuth redirect in a browser`);
  }
  ok("auth page is no-store and has no form-action ✓");

  // 5. Complete the chain: PKCE token exchange + a hosted-MCP call.
  const tok = await postForm("/api/oauth/token", {
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
    code_verifier: verifier, client_id: clientId,
  });
  if (tok.status !== 200 || !tok.json.access_token) fail(`token exchange failed (${tok.status}): ${JSON.stringify(tok.json)}`);
  ok("PKCE token exchange ✓");

  const mcp = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tok.json.access_token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const mcpJson = await mcp.json().catch(() => ({}));
  const toolCount = mcpJson?.result?.tools?.length ?? 0;
  if (toolCount < 1) fail(`hosted MCP tools/list returned ${toolCount} tools with the OAuth token`);
  ok(`hosted MCP reachable with the OAuth token — ${toolCount} tools ✓`);

  ok("PASS — real-browser OAuth login → redirect → token → MCP all work on the deployed artifact.");
};

main().catch((e) => fail(e?.message || String(e)));
