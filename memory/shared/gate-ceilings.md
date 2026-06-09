# Gate Ceilings — what FocusBoard's green CI does NOT prove

FocusBoard has now shipped THREE bugs invisible to fully-green CI. Pattern: each new gate closes the previous bug's class but not the next.

| # | Bug | Why CI was green | Gate added in response |
|---|-----|------------------|------------------------|
| 1 | `hono/vercel` handle() 504s on Node runtime | tests call `app.fetch()` in-process, bypassing the Vercel adapter | runtime-smoke gate (hits the deployed artifact) |
| 2 | Vercel platform-404 on multi-segment routes to `[...path].ts` | unit tests never exercise Vercel's path routing | (same runtime-smoke gate) |
| 3 | inbox hid captures the moment AI parsed them (status filter) | mocked-DB tests assert the call, not the rows; smoke gate checks only unauth status codes | regression test pinning the status set (PR #25) |

**Current ceiling — the runtime-smoke gate proves liveness/routing/auth, NOT data correctness.** It curls the live endpoint and asserts non-5xx + correct *unauthenticated* status codes. It will pass on an endpoint that is live, routes correctly, rejects anon callers — and returns the wrong rows to an authenticated caller. Bug #3 sat exactly in that blind spot.

**Next rung (decide per-phase, not yet built):** an authenticated post-deploy smoke using a dedicated low-privilege PAT stored as a CI secret — drive `capture → inbox shows it → dismiss`, idempotent and rollback-safe. This is the first gate that would have caught bug #3 automatically. Tradeoff: it needs a real test credential provisioned in CI and a cleanup step. Noted as the known ceiling; worth building when data-correctness endpoints multiply in Phase 2 (`/api/today`, `/api/cards`, `/api/wip`).

## Manual acceptance steps that gate correctness must run FIRST, not last
Phase 1's acceptance criterion ("CLI captures into prod; web inbox shows it live") was deferred to Claire as a final 1-minute step. It DID catch bug #3 — but only after merge + deploy. When a real credential is the only thing blocking an e2e correctness check, ask for the 1-minute manual step (or provision a test credential) BEFORE building on top of the unverified surface — not as the closing step.
