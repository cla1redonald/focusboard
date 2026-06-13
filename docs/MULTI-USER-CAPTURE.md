# Multi-user capture — architecture & plan

**Status:** design, not built. Today's capture (a personal Cloudflare Worker + 3 Google
Apps Scripts + an Apple Shortcut) is single-tenant scaffolding for one user
(`focusboard-capture-proxy/KNOWN-ISSUES.md`). This is the architecture to make capture a
real per-user product feature.

---

## 1. Key insight: the core is already multi-tenant

The data + API layers are built for many users; the single-user assumption is only in the
glue.

| Layer | Ready? | Evidence |
|---|---|---|
| DB isolation | ✅ | every table `user_id` + RLS `auth.uid() = user_id` |
| `capture_queue` | ✅ | per-user; `source` enum already has email/slack/shortcut/browser |
| `POST /api/capture` | ✅ | resolves `user_id` from the auth principal (`hono-app.ts:247`) |
| PAT auth + scopes | ✅ | `api_tokens` per-user/scope; `resolveApiToken` (`token.ts:55`) |
| OAuth 2.1 | ✅ stub | `oauth_clients/codes/tokens`; `resolveOAuthToken` (`token.ts:118`); routes unexposed |
| Token mgmt UI | ✅ | `SettingsPanel.tsx` create/revoke PATs |
| Webhook auth | ❌ | one shared `WEBHOOK_SECRET` → one `FOCUSBOARD_USER_ID` |

So this is **replacing glue with self-serve per-user connectors**, not a core rewrite.

---

## 2. Decisions that shape the design

1. **Flag-to-capture is personal-only, not a product feature.** Most people use email
   flags/stars for other things, and productising it needs Gmail restricted-scope OAuth
   (verification + paid security assessment) for marginal value. **Product email capture =
   forwarding**, with a sender-trust model (§4a). Claire's flag setup is grandfathered.
2. **Capture stays cheap on the hot path.** A deterministic **heuristic fast-path** handles
   the common cases; the **AI parse is optional, deferred, and budget-capped** (§5). No LLM
   call is required to accept a capture.
3. **One hardened inbound boundary.** The inbound email endpoint is the only service-role,
   cross-user write path — it is locked hard and minimal (§6).
4. **Auth on every channel; no env-based routing.** Each event resolves to a `user_id` from
   the request (PAT, OAuth token, verified email sender, or Slack mapping). Retire
   `FOCUSBOARD_USER_ID`.
5. **Slack is copy-link-first.** The published app is a bonus for workspaces that allow
   installs; the universal path stays copy-text/copy-link (§4c).

---

## 3. Data model

Reuse `api_tokens` for token channels (Shortcut/CLI/browser). Add:

```sql
-- Per-user inbound address: the part before @in.focusboard.app. High-entropy, rotatable.
capture_addresses(id, user_id, public_id unique, label, created_at, rotated_from, revoked_at)

-- Trusted senders/forwarders for a user's email capture (the spoofing defence).
capture_senders(id, user_id, address citext, status,   -- 'pending' | 'verified'
                auth_basis text,                        -- 'confirm-code' | 'forwarder-handshake'
                created_at, verified_at, revoked_at,
                unique(user_id, address))

-- Slack install: which FocusBoard user a (team,user) maps to.
slack_connections(id, user_id, team_id, slack_user_id, bot_token_enc,
                  created_at, revoked_at, unique(team_id, slack_user_id))

-- Unified connection list + health for the UI.
capture_connections(id, user_id, kind, ref_id, last_event_at, last_error,
                    created_at, revoked_at)
```

**Idempotency:** key off a real source id (RFC822 `Message-ID`, Slack `ts`) within a time
window; fall back to `hash(content)+短window` only when no id exists — so a genuine
re-capture after the window still lands (never silently dropped).

---

## 4. Channels

### 4a. Email — forward-only, sender-trusted
```
user (or their mailbox auto-forward)
        │  mail to  u_<publicId>@in.focusboard.app   (MX on a dedicated subdomain,
        ▼                                              SPF/DKIM/DMARC from day one)
inbound provider ──► POST /api/capture/inbound-email   [the hardened boundary, §6]
                         1. authenticate the provider (§6)
                         2. address → capture_addresses → user_id
                         3. SENDER TRUST: accept only if the message authenticates
                            (SPF/DKIM/ARC) as coming from a *verified* capture_senders
                            row for that user; else hold as 'pending sender' (surfaced
                            in the UI to approve once) — never silently injected
                         4. heuristic parse (§5) → insert capture_queue (service role,
                            source=email, idem=Message-ID)
                         5. return 2xx (else provider retries)
```

**Sender trust (the spoofing fix).** The address leaks by design (it's in every forward's
headers), so the address alone is *not* the gate. Capture is accepted only from **verified
senders/forwarders**:
- **Manual forwarders:** first mail from a new `From` is held, and the user approves that
  sender once in Settings → Integrations (or via a confirm-code). Thereafter it's verified.
- **Auto-forwarders:** when a user sets Gmail/Outlook auto-forward to their capture address,
  the provider's **confirmation-code handshake** is caught by the inbound endpoint and
  surfaced in the UI for the user to confirm — which both enables forwarding *and* records
  the forwarder as verified.
- Mail that authenticates as an approved sender is captured; anything else is held as
  "pending sender," visible and one-click-approvable, never auto-added.

This keeps "forward from any of your accounts" — you just approve each account once.

### 4b. Quick capture — Shortcut / mobile / desktop / browser
- Official **Apple Shortcut** (shareable link); first run asks for the user's **PAT** (minted
  in Settings → Integrations). The PAT is the per-user credential — no shared secret.
- **`capture.focusboard.app`** = a thin **Cloudflare pass-through** that forwards the
  caller's `Authorization` header to `/api/capture` (holds no secret, injects no token). It
  exists solely because Apple's NSURLSession can't reach Vercel's edge but *can* reach
  Cloudflare; auth is the user's own PAT, end to end. Handles CORS for the browser extension.
  *(Phase C task 1 verifies a Cloudflare **custom domain** is Shortcut-reachable — only
  `*.workers.dev` is proven today.)*
- One relay serves all users; backs the Shortcut, an Android share target, a browser
  extension, and the CLI.

### 4c. Slack — copy-link first, app optional
- Universal path (works in every workspace, incl. ones you don't admin): **copy message text
  or copy-link → quick capture.** No install.
- **Bonus** where installs are allowed: a distributable Slack app; OAuth install stores
  `(team_id, slack_user_id) → user_id` in `slack_connections`; the existing
  HMAC-verified `/api/slack/actions` resolves the user from that mapping instead of an env
  var. Unmapped triggers return an ephemeral "connect FocusBoard" link.

---

## 5. Capture parsing — cheap hot-path, AI as enhancement

Today `api/capture/process.ts` runs Claude on **every** capture — fine for one user, an
unbounded bill at scale. Redesign:
- **Fast-path (no LLM):** title = subject / first line; detect URL, obvious due-date words,
  source tags. Covers most captures, costs nothing, returns instantly.
- **AI parse is optional + deferred + capped:** only for long/ambiguous content, run async
  (not on the accept path), behind a **per-user and global budget** with a hard ceiling.
  Beyond budget, items stay as fast-path captures (still fully usable) and can be
  user-triggered ("parse this") later.
- Accepting a capture **never** depends on an LLM call.

---

## 6. The inbound boundary — the one hardened path

`POST /api/capture/inbound-email` is the only place that writes across users with the
service role, so it gets defence-in-depth and stays minimal:
- **Provider auth, layered** (providers vary — don't assume HMAC): secret-path URL **+**
  IP allow-list **+** the provider's own auth (basic-auth/token or signature where offered).
- **No user_id in the request** — user is resolved *only* via `capture_addresses` +
  sender-trust (§4a). The endpoint cannot be told who to write to.
- **Per-address and global rate limits** (contains a leaked address / a flood).
- Smallest possible surface, isolated handler, heavily tested; it is the highest-value
  target in the system.

Everything else (Shortcut/CLI/browser/Slack) authenticates as a normal per-user principal
(PAT/OAuth) through the existing middleware — no service-role shortcuts.

---

## 7. API & infra changes
- `POST /api/capture/inbound-email` — new, hardened (§6).
- `/api/slack/actions` — resolve user via `slack_connections`, drop `FOCUSBOARD_USER_ID`.
- Expose `POST /api/oauth/{register,authorize,token}` + `/.well-known/oauth-*` (the stub,
  with its `oauth_login_attempts` throttle + DCR limits) for the Slack/desktop connectors.
- `GET/POST/DELETE /api/capture-connections` — back the Integrations UI (mint address/PAT,
  approve senders, revoke, health).
- Capture API: stable idempotency (§3); split parse into fast-path + capped async AI (§5).
- New infra: product domain; `in.focusboard.app` (MX + SPF/DKIM/DMARC); inbound provider;
  `capture.focusboard.app` Cloudflare relay.

---

## 8. Settings → Integrations UI
- **Email:** your capture address (copy/rotate, with a grace window on the old one);
  **pending senders to approve**; verified senders list.
- **Apple Shortcut:** download + "generate device token" (capture-scoped PAT).
- **Slack:** "Add to Slack" where allowed; copy-link instructions otherwise.
- **CLI/API:** existing PAT management.
- **Health per connection:** last received, last error, send-test.

---

## 9. Phased plan (each phase shippable, each retires prototype glue)

- **A — Foundation.** Tables (`capture_addresses`, `capture_senders`, `slack_connections`,
  `capture_connections`); expose OAuth routes; Integrations UI scaffold + PAT mint.
- **B — Email.** Provider + `inbound-email` boundary (§6) + sender-trust (§4a) + per-user
  address. *Retires the 3 Apps Scripts.*
- **C — Quick-capture relay.** **Task 1: verify a Cloudflare custom domain is
  Shortcut-reachable.** Then `capture.focusboard.app` pass-through + official Shortcut +
  device-token UI. *Retires the personal Worker.*
- **D — Slack app.** OAuth install + `slack_connections` + per-user `/api/slack/actions`.
- **E — Parsing & polish.** Fast-path + capped async AI (§5); browser extension; Android
  share; capture-health; idempotency rollout.

## 10. Migrating Claire's prototype
Grandfathered until each channel lands, then: email scripts → a `capture_addresses` row
(her 3 accounts approved as verified senders); bespoke Worker → official Shortcut with her
own PAT against `capture.focusboard.app`; copy-link → the published Slack app. Her personal
flag-to-capture stays as a personal script, not part of the product.

## File references
`api/_lib/hono-app.ts:247` (capture; rate-limit 307; idem 320) · `auth-middleware.ts`
(INLINE_AUTH 55; webhook 138) · `token.ts` (PAT 55; OAuth 118) · `api/capture/process.ts`
(AI parse) · `mcp-server.ts:521+` (connector pattern) · `SettingsPanel.tsx:97` ·
`supabase/migrations/20260612120000_oauth_stub.sql` · `…/20260207170000_capture_queue.sql`
