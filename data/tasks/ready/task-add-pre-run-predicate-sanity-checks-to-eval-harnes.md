---
id: task-add-pre-run-predicate-sanity-checks-to-eval-harnes
title: Add pre-run predicate sanity checks to eval-harness fixtures
status: ready
priority: p2
area: eval-harness
summary: Make eval-harness fixtures prove their scoring predicates are non-vacuous against the initial state before running a workflow, so shortcut or already-satisfied fixtures cannot inflate pass rates.
created_at: 2026-05-17T04:50:10Z
updated_at: 2026-05-17T04:50:10Z
---

## Problem

`runFixture` materializes a fixture, invokes the workflow executor, and only
then evaluates the fixture's predicates. That means the harness can report a
pass even when the pass condition was already true in the fixture's initial
state, or when a weak final predicate can be satisfied by a shortcut that does
not exercise the intended workflow behavior.

KOTA already enforces fixture provenance: real failure or justified smoke
fixture. That protects why a fixture exists, but not whether the scoring
predicate is non-vacuous. The OpenAI SWE-bench Verified retirement post
reinforces the missing local guard: public benchmarks carry contamination risk,
and automated scoring must be robust to shortcut solutions and unimportant
implementation differences. KOTA's `pass^k` gate should not be able to rise
because a fixture accidentally starts in a passing state.

## Desired Outcome

Eval-harness fixtures declare and verify their initial-state scoring
expectations before the workflow runs. The runner records a pre-run sanity
phase that proves outcome predicates are initially unsatisfied, while allowing
fixture invariants that are intentionally true before and after the run.

A failed pre-run sanity check is a fixture configuration error, not a model or
workflow capability failure. It aborts the fixture attempt before invoking the
workflow executor and writes enough artifact detail for the fixture author to
fix the predicate or initial state.

## Constraints

- Keep the work inside `src/modules/eval-harness/`; do not add a core
  evaluation primitive or a parallel test framework.
- Reuse the existing predicate evaluator where possible. If a new predicate
  or result shape is needed, extend the typed union instead of adding an
  ad-hoc mini-language in fixture JSON.
- Every shipped fixture must be explicit about initial-state expectations.
  Do not make this an optional advisory field that the runner silently skips.
- Keep pre-run sanity distinct from final outcome scoring. A malformed fixture
  should surface as a configuration error and should not count as pass, fail,
  timeout, or provider noise in `pass@k` / `pass^k`.
- Preserve existing provenance validation, replay recordings, external-call
  shims, resource profiles, and run artifact layout.
- Do not weaken any existing final predicate to make migration easy. If a
  fixture's current predicate is vacuous, fix the fixture or add a stronger
  predicate.

## Done When

- Fixture loading validates an explicit pre-run sanity contract for every
  shipped fixture.
- `runFixture` evaluates the pre-run contract against the materialized initial
  working directory before invoking the workflow executor.
- A pre-run sanity failure aborts the fixture attempt with a typed outcome or
  typed configuration error and writes the pre-run predicate results into the
  fixture artifact.
- Existing fixtures are migrated with meaningful expectations, including at
  least one predicate that must be false initially and at least one invariant
  that is allowed to be true initially.
- Tests cover: already-satisfied outcome predicate rejected before executor,
  invariant predicate accepted, final predicates still evaluated after a
  successful sanity phase, and aggregate scoring not treating configuration
  errors as capability passes.
- `src/modules/eval-harness/AGENTS.md` records the convention at the same
  level as the provenance and predicate contracts.

## Source / Intent

Explorer run `2026-05-17T04-46-45-270Z-explorer-86695f` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add pre-run predicate sanity checks to eval-harness fixtures" --state ready --area eval-harness --priority p2 --summary "Make eval-harness fixtures prove their scoring predicates are non-vacuous against the initial state before running a workflow, so shortcut or already-satisfied fixtures cannot inflate pass rates."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External source checked:

- `https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/`
- `https://openai.com/research`

Local evidence:

- `src/modules/eval-harness/runner.ts` materializes the fixture and evaluates
  predicates only after executor completion.
- `src/modules/eval-harness/predicates.ts` already provides deterministic
  predicate evaluation that can be reused for initial-state checks.
- `src/modules/eval-harness/AGENTS.md` documents provenance and final
  predicate contracts, but not pre-run scoring sanity.

## Initiative

Eval-harness measurement integrity: KOTA's `pass^k` signal should reflect
workflow behavior against a meaningful fixture, not a vacuous final predicate,
shortcut scoring path, or accidentally pre-satisfied initial state.

## Acceptance Evidence

- Focused test transcript for the fixture loader, runner, predicates, and
  scoring paths, for example:

```sh
pnpm test src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts src/modules/eval-harness/predicates.test.ts src/modules/eval-harness/scoring.test.ts
```

- A fixture-run artifact showing a deliberately vacuous fixture rejected before
  the workflow executor starts, with pre-run predicate details recorded.
- Diff review shows every shipped fixture declares initial-state expectations
  and no final predicate was weakened during migration.
