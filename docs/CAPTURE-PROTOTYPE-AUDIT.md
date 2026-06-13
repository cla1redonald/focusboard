# FocusBoard capture system — known flaws

Honest audit of the capture setup (Cloudflare Worker + 3 Apps Scripts + Shortcut).
Built fast to work; these are the things that make it fragile, insecure, or low-quality.

## Single-tenant — only works for Claire (the architectural headline)

0. **The whole system is hardwired to one user. It cannot onboard a second user without
   rebuilding the entire stack by hand.** Every piece is Claire-specific:
   - The Worker injects *Claire's* roami capture token → every capture lands in *Claire's*
     FocusBoard, no matter who or what calls it.
   - The Worker URL is personal (`...cla1re.workers.dev`); the alias is personal
     (`claire+focusboard@roami.group`); the 3 Apps Scripts live in *Claire's* Google
     accounts; the Shortcut/Action Button are on *Claire's* devices.
   - There is no concept of "which user is this capture for" — routing is implicit and
     single-valued.
   A real product needs per-user capture: each user connects their own mail (e.g. a Gmail
   add-on / OAuth), gets their own capture address, and captures route to *their* account.
   None of that exists. As built, this is bespoke scaffolding for exactly one person.

## Security (highest priority)

1. **The Worker is an unauthenticated open relay.** `focusboard-capture.cla1re.workers.dev`
   accepts ANY POST and injects the capture token. Anyone who learns the URL can spam the
   FocusBoard inbox — no auth, no rate limit, no abuse protection. The URL is in 3 Apps
   Scripts + the Shortcut, so it leaks easily.
   → Fix: require a shared secret header (Worker checks it; Shortcut + scripts send it).
   Add basic rate limiting.

2. **Single token = single point of failure.** One roami capture PAT, held in the Worker,
   serves every channel. Rotate/revoke it and ALL capture (Shortcut, 3 email scripts, Slack
   copy) dies at once, silently.

## Reliability

3. **Silent failures.** Apps Scripts use `muteHttpExceptions: true` and there's no alerting.
   If the Worker is down, the token is bad, or Gmail errors, captures vanish with no notice.
   You'd never know an email didn't make it.

4. **5-minute latency** on email/flag capture (the trigger interval). Not instant.

5. **Duplicate captures.** The Worker sends a random Idempotency-Key per call, so the
   capture API's dedup does nothing. Dedup relies ONLY on the Gmail label being written
   after a successful POST — if that write fails, or two runs overlap, you get duplicates.
   Forwarding AND flagging the same email = 2 captures.

6. **Captures the wrong message in a thread.** The script grabs only the LATEST message of
   a matched thread. Flag an older message in a long thread → it captures the newest one
   instead, not the one you flagged.

## Quality of captured data

7. **Forwarded-email cruft.** Plain-text body includes all the `>` quoted forwarding
   headers ("Begin forwarded message…"). Captures are messy, not the clean content.

8. **Lossy.** Plain text only, truncated at 4000 chars. No attachments, links, images, or
   formatting. A flagged newsletter becomes a wall of text.

## Maintainability

9. **3 duplicated Apps Scripts** (one per Google account), plus clasp's one-login-at-a-time
   juggling. Any change (e.g. the Worker URL) must be pushed to all 3 by hand.

10. **Bespoke glue on personal accounts.** Worker on a personal Cloudflare, scripts on
    personal Google accounts — none of it is in the FocusBoard repo or productized. If
    FocusBoard is meant to be a real product, this is throwaway scaffolding for one user.

## UX gaps vs the original goal

11. **macOS Share Sheet doesn't work** for the apps that matter (Mail, WhatsApp). Apple's
    limitation, but it means the "share from anywhere" promise is half-true on Mac.

12. **Not actually one-click** except flag-to-capture. Action Button needs type/paste;
    hotkey needs a text selection.

13. **Slack is just copy-paste**, not integration — loses sender/channel/permalink unless
    you manually copy a link too.

14. **Flag mechanism hijacks the star.** It captures ANY starred email and then clears the
    star — so you can't use flags/stars for anything else, and an auto-starred or
    accidentally-starred email gets captured + un-starred (noise + lost marker).
