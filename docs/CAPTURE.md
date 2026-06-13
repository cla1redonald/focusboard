# Capturing into FocusBoard from anywhere

> **This describes Claire's personal, single-user prototype.** It is not the
> productised design. For the known flaws and shortcuts of this setup, see
> [`CAPTURE-PROTOTYPE-AUDIT.md`](./CAPTURE-PROTOTYPE-AUDIT.md). For the
> multi-user target this is meant to become, see
> [`MULTI-USER-CAPTURE.md`](./MULTI-USER-CAPTURE.md).

Every channel below POSTs to the **Cloudflare Worker**, not to the capture API
directly:

```
POST https://focusboard-capture.cla1re.workers.dev
```

The Worker is the linchpin. It exists because **Apple Shortcuts cannot reach
Vercel's edge** — `Get Contents of URL` fails with error `-1005` ("The network
connection was lost") against any `*.vercel.app` (or Vercel-fronted) host. The
Worker sits on Cloudflare's edge, which Shortcuts *can* reach, then forwards the
request to the real capture API **server-side and injects the capture PAT**. So
no caller ever carries the PAT — they only need the Worker's shared secret.

> **Do not "fix" this by swapping the URL.** The custom domain
> `focusboard.roami.help` exists and points at the app, but it's still Vercel
> edge, so the Shortcut still hits the `-1005` bug through it. **Only the
> Cloudflare Worker URL works.** Leave it as `focusboard-capture.cla1re.workers.dev`.

## The secret every caller must send

The Worker rejects anything without the header `X-FB-Key`:

```
X-FB-Key: <X-FB-Key secret>
```

Without it the Worker returns **401** and nothing is forwarded. The secret value
lives in `~/.config/focusboard/worker-proxy-secret.txt` (never commit it; this
doc refers to it only as `<X-FB-Key secret>`). The Worker holds it as a
`wrangler` secret on its side; callers send the matching value.

The body the Worker expects (and forwards) is the same minimal shape for every
channel:

```json
{ "content": "the text to capture", "source": "shortcut" }
```

Captures land in the **Capture Inbox** for triage — they don't auto-add to the
board. The `source` enum supports: `email, slack, shortcut, browser, whatsapp,
in_app`.

---

## 1. Apple Shortcut — Share Sheet from email / iMessage / WhatsApp / Slack / Safari

One Shortcut, added to the Share Sheet, gives you **"Add to FocusBoard"** on
anything with a Share button — iPhone, Mac, Siri, and the Action Button.

**Build it (Shortcuts app → + New Shortcut):**

1. **Shortcut name:** `Add to FocusBoard`.
2. **Settings (ⓘ icon):** turn ON **"Show in Share Sheet"**. Under *Share Sheet
   Types*, leave the default (Text + URLs) or pick "Anything".
3. Add action **"Receive [Text] input from Share Sheet"** — set "If there's no
   input" to **Ask for Text** (so it also works standalone / via Siri).
4. Add action **"Get Contents of URL"**:
   - URL: `https://focusboard-capture.cla1re.workers.dev`
   - Method: **POST**
   - Headers:
     - `Content-Type` = `application/json`
     - `X-FB-Key` = `<X-FB-Key secret>`
   - Request Body: **JSON**, with two fields:
     - `content` = the **Shortcut Input** variable
     - `source` = `shortcut`
5. (Optional) Add **"Show Notification"** → `Captured ✓` for a toast.

**Use it:** in Mail / Messages / WhatsApp / Slack / Safari → **Share** →
**Add to FocusBoard**. Or *"Hey Siri, Add to FocusBoard"*. Or bind it to the
iPhone **Action Button**.

> No `Authorization` header, no PAT — the Worker injects the PAT. The Shortcut
> only carries `X-FB-Key`. WhatsApp & iMessage have no native webhook, so the
> Share Sheet is the right-click-to-FocusBoard mechanism for them.

---

## 2. Email-to-capture — flag/star or forward a mail

Email capture runs on **Google Apps Script**, one deployment per Google account:

| Account            | Script project                                   |
|--------------------|--------------------------------------------------|
| roami              | `~/code/focusboard-email-capture/`               |
| clairedonald1982   | `~/code/focusboard-email-clairedonald1982/`      |
| rational           | `~/code/focusboard-email-rational/`              |

Each is a [clasp](https://github.com/google/clasp) project. The script searches
Gmail on a time trigger and POSTs matching mail to the **Worker** (with
`X-FB-Key`, `source: "email"`), exactly like every other channel.

**Two ways to capture a mail:**

- **Flag / star it** — any colour star counts.
- **Forward it** to the alias `claire+focusboard@roami.group`.

**Behaviour:**

- Trigger runs on a schedule, so expect **~5 minutes of latency** before a
  flagged/forwarded mail appears in the inbox.
- Once captured, the script **labels the thread `FocusBoardCaptured` and
  unstars it**, so it isn't picked up again.

> This is **not** Cloudflare Email Routing and **not** Zapier — those were
> earlier ideas and are not in use. It is Apps Script + Gmail per account.

---

## 3. Slack — copy text/link → quick capture

There is no Slack app and no message shortcut. Claire is a **non-admin** member
of the Slack communities she's in, so she can't install an app there.

**Use it:** copy the message text (or copy the message link), then capture it
via the **Apple Shortcut** (Share / paste) or in-app quick capture. It lands in
the inbox like any other capture.

---

## Revoking / rotating access

Two secrets gate the whole pipeline:

- **Worker `X-FB-Key`** — the shared secret every caller sends. Rotate it with
  `wrangler secret put X_FB_KEY` (or the configured name) on the Worker, then
  **re-push the new value** to the Apps Script projects and update the Apple
  Shortcut. Anything still sending the old key gets 401.
- **The Worker-injected capture PAT** — the single point of failure. It's stored
  on the Worker (not in any caller). **Rotating it kills every channel at once**
  until the Worker is updated with the new PAT. Re-mint via Settings → API
  Tokens, then update the Worker secret.

Revoking the PAT is the fastest "kill switch" for all capture; rotating
`X-FB-Key` locks out callers without touching the board's API access.
