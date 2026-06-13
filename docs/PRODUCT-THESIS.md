# FocusBoard product thesis — why this isn't a wrapper

**One line:** *Todoist stores your tasks; FocusBoard learns how you actually work — and
tells you the truth about it.*

## The wrapper trap
A wrapper is stateless: input → LLM → output, then it forgets you. Its "intelligence" is
rented from a model anyone can call, so it has no moat and no memory of you. Most "AI task
apps" are this.

## The moat is the feedback loop, not the model
The LLM is a commodity component. The proprietary asset is a **labelled, longitudinal record
of how one person works** — and FocusBoard already captures three loops most apps discard:

1. **Capture → triage decisions** (`capture_queue`: what came in, what was kept / edited /
   dismissed). Every triage is a labelled judgment of *signal vs noise* for this person.
2. **Focus sessions** (`focus_sessions`: planned vs actual minutes, outcome =
   progressed/blocked/completed/abandoned, notes). Ground-truth behaviour: estimation bias,
   what blocks them, what they finish vs avoid, when.
3. **Card lifecycle** (`cards`: dwell time, archived-without-completion, recurrence). The
   honest mirror — what's actually rotting and being avoided.

## Why it's defensible
- **Only FocusBoard has it.** ChatGPT can't see what you dismissed last month or your last
  200 focus sessions. The model is a function of data that lives only here.
- **It compounds.** More use → sharper personal model → higher switching cost. A
  single-player data network effect.
- **It's self-labelling.** Users generate the training signal just by using the app
  honestly — no dataset to buy or build.

## What the product *becomes*
A **personal operating model**: your real capacity, your estimation bias, your peak hours,
your avoidance patterns, your recurring blockers — built only from your history. It gets
**proactive**: not "ask me to prioritise," but *"3 cards are aging out, your estimate on X
is optimistic, it's your peak window — start Y."*

## Non-negotiables
- **Trust is the product.** This is intimate behavioural data — it's the user's, transparent,
  exportable, deletable, never sold. "Privacy-respecting AI that's genuinely yours" is itself
  the wedge against Big Tech tools.
- **Honest mirror, not a nag.** Truthful insight with the human in control — never
  auto-doing things or guilt-tripping.
- **Cheap by design.** The intelligence is mostly *deterministic statistics over your own
  data*, not an LLM call per action (see `PERSONAL-INTELLIGENCE.md`). The model layer is the
  garnish, not the engine — which is exactly why it's a durable product and not a wrapper.

Build order: **multi-user capture first** (`MULTI-USER-CAPTURE.md`) — it fills the loops with
data — then the intelligence layer (`PERSONAL-INTELLIGENCE.md`).
