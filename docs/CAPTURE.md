# Capturing into FocusBoard from anywhere

Everything below POSTs to the **same hardened capture API** —
`POST https://focusboard-claire-donalds-projects.vercel.app/api/capture` —
which is PAT-authed, idempotent, rate-limited, and tags each item with a
`source`. Captures land in the **Capture Inbox** for triage (they don't auto-add
to the board). The `source` enum already supports: `email, slack, shortcut,
browser, whatsapp, in_app`.

The capture token for the Shortcut + email bridge is a **capture-only PAT**
(scopes `capture:read`/`capture:write`, revocable independently). Yours is in
`~/.config/focusboard/capture-integration-token.txt`. Below it's written
`<TOKEN>` — never commit the real value.

The API request every channel makes:

```
POST /api/capture
Authorization: Bearer <TOKEN>
Content-Type: application/json
Idempotency-Key: <any stable id for retries>     # optional but recommended

{ "content": "the text to capture", "source": "shortcut" }
```

---

## 1. Apple Shortcut — Share Sheet from email / iMessage / WhatsApp / Slack / Safari

One Shortcut, added to the Share Sheet, gives you **"Add to FocusBoard"** on
anything with a Share button — on both iPhone and Mac, plus Siri.

**Build it (Shortcuts app → + New Shortcut):**

1. **Shortcut name:** `Add to FocusBoard`.
2. **Settings (ⓘ icon):** turn ON **"Show in Share Sheet"**. Under *Share Sheet
   Types*, leave the default (Text + URLs) or pick "Anything".
3. Add action **"Receive [Text] input from Share Sheet"** — set "If there's no
   input" to **Ask for Text** (so it also works when you run it standalone/Siri).
4. Add action **"Text"** → set its value to the **Shortcut Input** variable
   (this is the captured content).
5. Add action **"Get Contents of URL"**:
   - URL: `https://focusboard-claire-donalds-projects.vercel.app/api/capture`
   - Method: **POST**
   - Headers:
     - `Authorization` = `Bearer <TOKEN>`
     - `Content-Type` = `application/json`
   - Request Body: **JSON**, with two fields:
     - `content` = the **Text** variable from step 4
     - `source` = `shortcut`
6. (Optional) Add **"Show Notification"** → `Captured ✓` so you get a toast.

**Use it:** in Mail / Messages / WhatsApp / Slack / Safari → **Share** →
**Add to FocusBoard**. Or *"Hey Siri, Add to FocusBoard"*. Or bind it to the
iPhone **Action Button**.

> WhatsApp & iMessage have no native webhook — the Share Sheet IS the
> right-click-to-FocusBoard mechanism for them.

---

## 2. Email-to-capture — forward or send an email

Forward any email to a dedicated address → it becomes a capture. FocusBoard
can't receive raw email itself (it's serverless), so one tiny bridge receives
the email and POSTs to `/api/capture` with `source: "email"`. Two options:

### Option A — Cloudflare Email Routing + Email Worker (free, clean)
If you have a domain on Cloudflare:
1. Cloudflare dashboard → your domain → **Email → Email Routing** → enable.
2. Create a **custom address** (e.g. `capture@yourdomain`) → action **Send to a
   Worker**.
3. Create the Worker (the email's subject becomes the title, body the notes):

```js
export default {
  async email(message, env) {
    const subject = message.headers.get("subject") || "(no subject)";
    // Read a short plain-text slice of the body.
    let body = "";
    try {
      const reader = message.raw.getReader();
      const { value } = await reader.read();
      body = new TextDecoder().decode(value).slice(0, 4000);
    } catch {}
    await fetch("https://focusboard-claire-donalds-projects.vercel.app/api/capture", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.FOCUSBOARD_CAPTURE_TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": message.headers.get("message-id") || crypto.randomUUID(),
      },
      body: JSON.stringify({ content: `${subject}\n\nfrom ${message.from}`, source: "email" }),
    });
  },
};
```
   Set `FOCUSBOARD_CAPTURE_TOKEN` as a Worker secret. Forward/send to
   `capture@yourdomain` → it lands in your inbox.

### Option B — Zapier / Make (no code, ~5 min)
1. Trigger: **"Email by Zapier"** (gives you a `…@robot.zapier.com` address) or
   a Gmail "new email matching" trigger.
2. Action: **Webhooks → POST** to `/api/capture` with the `Authorization` header
   and a JSON body `{ content: <subject + body>, source: "email" }`.
3. Forward emails to that address (or set a Gmail filter to auto-forward).

---

## 3. Slack — right-click a message → Add to FocusBoard

FocusBoard ships a Slack endpoint at **`/api/slack/actions`** (signature-verified
with your app's signing secret). You create a small Slack app with a **Message
Shortcut** pointed at it.

**Set up the Slack app:**
1. <https://api.slack.com/apps> → **Create New App → From scratch** → pick your
   workspace.
2. **Interactivity & Shortcuts** → turn **Interactivity ON** → Request URL:
   `https://focusboard-claire-donalds-projects.vercel.app/api/slack/actions`
3. Still there → **Create New Shortcut → On messages** → name it
   *"Add to FocusBoard"*, callback id anything (e.g. `add_to_focusboard`). Save.
4. **Basic Information → App Credentials → Signing Secret** → copy it.
5. Add it to Vercel: `vercel env add SLACK_SIGNING_SECRET` (production) — paste
   the secret. (Or the dashboard.) Redeploy.
6. **Install App** to your workspace.

**Use it:** in Slack, hover any message → **⋯ More actions → Add to
FocusBoard**. You'll get an ephemeral "✓ Captured to FocusBoard" and the message
lands in your inbox (deduped if you click twice).

The endpoint verifies Slack's HMAC signature + a 5-minute timestamp window
(replay protection), maps to your account via `FOCUSBOARD_USER_ID`, and needs
`SLACK_SIGNING_SECRET` set. No PAT is involved — Slack signs its own requests.

---

## Revoking access
- **Shortcut / email token:** Settings → API Tokens (revoke "capture-integrations"),
  or delete that `api_tokens` row. Re-mint with `scripts/` admin tooling.
- **Slack:** uninstall the Slack app, or rotate `SLACK_SIGNING_SECRET`.
