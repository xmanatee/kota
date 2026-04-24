---
id: task-add-decomposer-shoulddecompose-false-smoke-fixture
title: Add decomposer shouldDecompose-false smoke fixture exercising triggerPayload plumbing
status: blocked
priority: p2
area: autonomy
summary: Seed a smoke fixture for decomposer that replays a non-timeout-shaped builder run via triggerPayload, asserting the assess-failure gate correctly chose shouldDecompose: false and skipped the agent step — establishing end-to-end regression coverage of decomposer's decision gate plus the triggerPayload subprocess-executor plumbing without any agent-call cost.
created_at: 2026-04-24T12:21:41.524Z
updated_at: 2026-04-24T14:00:00.750Z
---

## Problem

`src/modules/eval-harness/fixtures/uncovered/notes.md` retires the
decomposer workflow from the uncovered list pending a bootstrap follow-up:
the representative real-failure shape (from
`.kota/runs/2026-04-18T15-45-49-339Z-decomposer-zloyo6`) is now expressible
via the new typed `triggerPayload` plumbing on `FixtureSpecFile` and
`subprocess-executor.ts`, but any fixture that exercises the `decompose`
agent step itself would cost a real autonomous LLM run per replay and
dominate eval-set cost.

The decomposer workflow already has a natural short-circuit: the
`assess-failure` step sets `shouldDecompose: false` whenever the triggering
builder run does not look timeout-shaped (non-timeout error, missing
metadata, no task in `doing/`, etc.) and the subsequent `decompose` agent
step's `when` predicate gates it out. That branch is a real decision gate —
getting it wrong would either over-decompose healthy failures or miss a
timeout that should have been decomposed — but today it has no harness-
layer regression coverage at all.

No existing fixture exercises `triggerPayload` end-to-end either. The
dispatcher smoke fixture covers the new `run-emits-event` /
`run-omits-event` predicate kinds against a payload-free `manual` trigger;
the decomposer path is the only workflow shipped today whose trigger is a
structured payload.

## Desired Outcome

A new smoke fixture under `src/modules/eval-harness/fixtures/` replays a
seeded non-timeout-shaped builder run through the decomposer workflow via
`triggerPayload`, asserts that `assess-failure` correctly returned
`shouldDecompose: false`, and asserts that no new task file was produced.
The fixture runs inside the existing subprocess-executor path — no agent
call, no network, no operator-repo access — and trips loudly if either the
`triggerPayload` forwarding or the decision gate regresses. The fixture's
`provenance.kind` is `"smoke-fixture"` with a written justification naming
the two harness-plumbing invariants it captures that no real-failure
fixture captures today (triggerPayload forwarding + `assess-failure`
decision without an agent call).

## Constraints

- Smoke-fixture justification must explicitly name both invariants the
  fixture exists to lock: (1) `triggerPayload` round-trips verbatim through
  `kota workflow trigger --payload ...`, (2) decomposer's `assess-failure`
  short-circuits to `shouldDecompose: false` on a non-timeout-shaped
  builder run. The justification lives in `fixture.json` per the fixture-
  provenance contract in `src/modules/eval-harness/AGENTS.md`; it does not
  need a parallel copy elsewhere.
- Seeded `initial/` state must be the minimum needed to reach the decision
  gate: one builder run directory under `.kota/runs/<id>/metadata.json`
  whose `steps` show a non-timeout `build` failure (e.g. a short-duration
  failure with a non-timeout error string), an AGENTS.md-compliant task
  file in `data/tasks/doing/` so the decomposer can still locate a
  candidate, plus the minimal `data/tasks/` layout required by KOTA's
  queue validator.
- Predicates stay artifact-based and small. Use the existing `file-exists`
  / `file-absent` / `file-contains` predicate kinds to assert: the seeded
  task file is unchanged, no new task file appeared anywhere under
  `data/tasks/`, and the decomposer's own run metadata records the
  `decompose` step as `skipped`. Do not introduce a new predicate kind
  just for this fixture — if the final assertion cannot be expressed with
  the existing kinds against the working directory, surface the gap in
  `uncovered/notes.md` and stop instead of paper-over coding.
- Budget and resource profile follow the harness's infrastructure-noise
  rule: explicit `budgetMs` sized for a decision-only run (no agent step,
  no builder re-invocation), matching allocation vs kill thresholds, and
  at least k=1 per fixture spec.
- The fixture must not depend on any `.kota/runs/` data the operator's
  real repo happens to carry. Every file the decomposer reads must come
  from the fixture's `initial/` tree, so `HOME` remapped to the fixture
  working dir plus the normal subprocess isolation is sufficient.
- Do not extend `FixtureSpecFile` or the subprocess-executor for this
  task. Both are already plumbed for `triggerPayload`; the fixture only
  has to use the existing surface.
- Do not remove decomposer from `uncovered/notes.md` entirely — the entry
  still stands for the real-failure agent-step path. Narrow the note so
  it records that the decision-gate branch is now covered by the smoke
  fixture and the bootstrap blocker only applies to the `shouldDecompose:
  true` agent-call path.

## Done When

- `src/modules/eval-harness/fixtures/decomposer-short-circuits-on-non-timeout/`
  (or an equivalently named fixture directory) exists with `fixture.json`,
  an `initial/` tree, and a `notes.md` explaining the seeded state and
  predicate rationale.
- `fixture.json` sets `provenance.kind = "smoke-fixture"` with a
  justification naming the two harness-plumbing invariants above.
- `fixture.json` declares a `triggerPayload` whose shape matches
  decomposer's `workflow.completed` trigger payload (workflow: "builder",
  runId, runDir, status: "failed", triggerEvent, tags, autonomyMode).
- Running the fixture end-to-end via `pnpm kota eval run` (or the
  equivalent subprocess-executor entry) finishes within the declared
  `budgetMs` on the default host class and all predicates pass.
- If the decomposer's decision gate regresses (e.g. `isTimeoutShaped`
  starts returning `true` for the seeded non-timeout builder failure),
  the fixture fails loudly via an artifact predicate — confirmed by a
  temporary local patch that inverts the gate, reverted before commit.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` is updated so
  the decomposer entry reflects the split: decision-gate path covered by
  the smoke fixture here, agent-call path still retired pending a
  separate agent-step bootstrap follow-up.
- `pnpm kota eval list` includes the new fixture without a
  `FixtureProvenanceError`.
- `src/modules/eval-harness/AGENTS.md` still documents only the shape
  contract and provenance rule — no per-fixture inventory.

## Blocker

Blocked on infrastructure gap: `pnpm kota eval run` cannot finish any
workflow fixture end-to-end today. The subprocess-executor spawns
`kota workflow trigger <name> --force --payload ...`, which only enqueues
a pending run into `WorkflowRunStore`. Without a daemon running in the
fixture's isolated `HOME`/`KOTA_PROJECT_DIR` (tmpdir), nothing executes
the pending run, so the runner always returns `timeout` after `budgetMs`
with zero `.kota/runs/` entries produced. Reproduced on the already-
shipped `dispatcher-emits-on-ready-queue` smoke fixture: the
`pnpm kota eval run --fixture dispatcher-emits-on-ready-queue --repeats 1`
invocation at `.kota/eval-runs/2026-04-24T13-24-59-975Z/` times out at
60s with 0 emitted events, and every prior attempt at this decomposer
fixture under `.kota/eval-runs/` (`2026-04-24T13-00-04-083Z` etc.)
exhibited the same shape ("decomposer runs: 0").

The task's Done When #4 ("Running the fixture end-to-end via
`pnpm kota eval run` ... finishes within the declared `budgetMs` ...
all predicates pass") and Done When #5 (critic-verified flipped-gate
regression that requires the fixture to actually run) are therefore
unreachable. The task's Constraints also explicitly forbid extending
`subprocess-executor.ts` as part of this work. The honest fix is a
separate enabler that makes the subprocess-executor actually execute
queued runs (e.g. by spawning a per-fixture daemon, draining pending
runs inline, or adding a single-pass run command).

Unblock when `task-fix-eval-harness-subprocess-executor-daemon` ships
and any smoke fixture (dispatcher or otherwise) actually passes
end-to-end under the default host class.
