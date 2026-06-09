# Common Mistakes

## Mocked-DB tests pass on semantically-wrong queries
**What happens:** An endpoint's correctness IS its filter (inbox views, search, WIP counts, "awaiting triage" sets). Unit tests that mock Supabase assert that *a* query was issued with *some* args — they cannot assert it selects the *right rows*. FocusBoard: `GET /api/capture` filtered `status='pending'` only; 46 mocked API tests stayed green while the endpoint returned nothing the moment the AI pipeline promoted `pending → ready`. Caught only by a real-token manual run (PR #25).
**Root cause:** A mock has no schema and no data lifecycle. It validates the call shape, not the result set, so a wrong-but-well-formed filter is indistinguishable from a correct one.
**Prevention:** For any endpoint whose correctness is its filter, do ONE of: (a) an integration test against a real local Postgres/Supabase that inserts rows in each lifecycle state and asserts which come back; or (b) extract the filter values to a shared constant imported by every surface, so drift is a compile error not a runtime bug (see "Cross-surface invariants" below).
**Detection:** A real-credential e2e (capture → list → assert presence). Review heuristic: "this test mocks the DB and asserts a filter literal — does any test prove the *rows* are right?"

## Cross-surface invariants drift when expressed as parallel literals
**What happens:** Two surfaces must agree on a meaning ("which statuses are awaiting triage") but each hard-codes its own literal list. They drift silently. FocusBoard: the CLI inbox (`api/_lib/hono-app.ts`) and the web inbox (`src/app/useCaptureQueue.ts`) each carry their own `status` list; the CLI's diverged and hid captures.
**Root cause:** The invariant lives in N copies with nothing keeping them in sync, so a change to one is a runtime bug instead of a compile error.
**Prevention:** One shared module exports the set (e.g. `TRIAGE_STATUSES`); every surface imports it. Drift becomes a type/compile error. FocusBoard already has a natural home: `src/app/captureTypes.ts` (exports `CaptureStatus`). **Open follow-up (Phase 2):** extract `TRIAGE_STATUSES` and import it in both `hono-app.ts` and `useCaptureQueue.ts` BEFORE building `/api/today`, `/api/cards`, `/api/wip` — each will re-create the same parallel-literal risk against the web's filters. As of PR #25 the literals are still parallel (only the values were fixed).
**Detection:** `grep` for the same literal set in 2+ surface files with no shared import. Review prompt: "where else is this value/set defined, and does anything keep them in sync?"

## Tests written after the implementation pin the implementation, not the requirement
**What happens:** A test asserts a filter/constant copied verbatim from the code under test. It's a change-detector, not a correctness check — it will stay green through any bug that the implementation and the test share. FocusBoard: the requirement actually lived in two *other* files (the `process.ts` lifecycle that promotes `pending→ready`, and `useCaptureQueue.ts`'s triage set), so a test pinned to `hono-app.ts`'s own literal proved nothing.
**Root cause:** Co-deriving the test and the code from the same source means the test can only catch deviations from the code, never deviations from the requirement.
**Prevention:** Derive the assertion from the requirement's *source of truth* (here: the lifecycle in `process.ts` + the web triage set), not from the line under test. Prefer an independently-stated expected set or an integration test over a literal copied from the implementation.
**Detection:** Review prompt: "is this expected value copied from the code under test, or derived from the spec/another surface? Where else is this value defined, and does anything keep them in sync?"
