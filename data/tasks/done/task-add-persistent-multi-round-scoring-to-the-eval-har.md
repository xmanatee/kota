---
id: task-add-persistent-multi-round-scoring-to-the-eval-har
title: Add persistent multi-round scoring to the eval harness
status: done
priority: p2
area: modules
summary: Extend eval-harness fixtures to execute ordered builder rounds against one preserved workspace with cumulative predicates, so KOTA can catch requirement drift and regression across evolving task instructions instead of only final single-workflow outcomes.
created_at: 2026-05-28T00:15:02.451Z
updated_at: 2026-05-28T00:35:23.775Z
---

## Problem

KOTA's eval harness materializes a fixture once, runs one workflow once, and
scores the final workspace. That is enough for single-shot builder behavior and
for replay-backed workflow regressions, but it does not model the failure shape
where a coding agent succeeds at round 1 and then loses requirements, regresses
prior behavior, or rewrites architecture poorly when round 2/3/4 arrives.

Recent coding-agent eval work is making that gap concrete. EvoCode-Bench
evaluates agents across 5-15 preserved-workspace rounds with cumulative tests;
SpecBench separately shows that visible validation tests can be saturated while
held-out composition behavior still fails. KOTA already has several compact
builder fixtures, including product requirements and multi-service integration,
but the harness cannot express ordered rounds with per-round outcomes and
cumulative predicates. The closest local fixture folds a follow-up change into
one builder task, so the run artifact cannot say which round introduced drift.

## Desired Outcome

The eval harness supports an explicit persistent multi-round fixture mode:

- A fixture can declare an ordered sequence of rounds that all execute against
  one preserved working directory.
- Each round has its own task seed or trigger input, budget, workflow execution
  record, predicates, and objective metrics.
- Later rounds can declare cumulative predicates that must keep earlier-round
  behavior alive.
- The per-run artifact records round-level outcomes plus the aggregate fixture
  result so regression analysis can distinguish "failed to start", "round N
  regressed prior behavior", and "final state passed".
- At least one compact local builder fixture uses the mode to exercise evolving
  requirements without importing an external benchmark.

## Constraints

- Keep this inside `src/modules/eval-harness/`; do not add a second benchmark
  runner, fixture DSL, or metrics store.
- Preserve strict fixture schema validation. If multi-round requires a new
  shape, make it discriminated and fail loudly on mixed or malformed single-vs-
  multi-round fields.
- Existing single-workflow fixtures must keep their current behavior unless
  they are deliberately migrated to the new mode.
- Round materialization must preserve the same git/worktree safety guarantees
  as `runFixture`: isolated tmpdir, initialized git repo, protected bare-repo
  env, no mutation of fixture `initial/`.
- Do not leak cost or model-choice optimization into agent-facing context.
- The first local fixture should be small and deterministic. Do not import
  EvoCode-Bench, RoadmapBench, or SpecBench wholesale.
- Keep live-LLM execution out of `pnpm test` unless replay-backed. Unit tests
  may use a fake executor to prove the round orchestration.

## Done When

- `FixtureSpecFile` (or a deliberately separate spec type) has a typed
  multi-round mode that validates:
  - ordered non-empty rounds,
  - per-round budget/workflow/task input,
  - per-round predicates and pre-run expectations,
  - aggregate predicates/objective metrics where needed,
  - malformed mixed single-round and multi-round specs as hard loader errors.
- The runner executes multi-round fixtures in one preserved working directory
  and writes a round-aware `fixture-run.json`.
- Scoring treats a multi-round fixture as one fixture for `pass@k` / `pass^k`,
  while preserving round outcomes for diagnosis.
- Tests cover at least:
  - loader rejection for invalid round specs,
  - round order and preserved workspace with a fake executor,
  - a later-round regression failing the fixture even when the final executor
    returns `completed`,
  - existing single-workflow fixtures still loading and running unchanged.
- A compact builder fixture demonstrates the new mode with evolving
  requirements and cumulative behavior checks.
- `src/modules/eval-harness/AGENTS.md` is updated only if the durable fixture
  contract changes.

## Source / Intent

Explorer run `2026-05-28T00-12-11-277Z-explorer-3ic2u3` received an empty
actionable queue while all strategic blocked alternatives were operator-capture
waits. The nonduplicative signal came from recent long-horizon coding-agent eval
sources:

- https://arxiv.org/abs/2605.24110 — EvoCode-Bench: Evaluating Coding Agents in
  Multi-Turn Iterative Interactions. The paper evaluates preserved-workspace
  coding tasks over 5-15 rounds with cumulative executable tests and reports a
  large gap between single-round and persistent multi-round performance.
- https://huggingface.co/datasets/anonymousee8/evocodebench — released dataset
  for the same benchmark, including round-level instructions and executable
  verification assets.
- https://arxiv.org/abs/2605.21384 — SpecBench: Measuring Reward Hacking in
  Long-Horizon Coding Agents. The paper reinforces the visible-vs-held-out
  composition failure mode that cumulative predicates should catch.

## Initiative

Autonomy eval harness: KOTA should measure builder behavior that survives
evolving requirements, not just final single-workflow success.

## Acceptance Evidence

- Focused test transcript covering the new loader and runner behavior, including
  the preserved-workspace fake-executor case.
- `pnpm kota eval list` transcript showing the new multi-round fixture loads
  and existing fixtures still load.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` transcript or
  checked run artifact showing round-level outcomes in `fixture-run.json`.
- A deliberate later-round regression fixture/test fails before the fix and
  passes after the round-aware scoring is implemented.

## Completion Evidence

- `.kota/runs/2026-05-28T00-17-41-884Z-builder-mzgzz3/focused-test-transcript.txt`
  captures focused loader, runner, scoring, shipped-fixture, and strict-types
  tests passing.
- `.kota/runs/2026-05-28T00-17-41-884Z-builder-mzgzz3/eval-list-transcript.txt`
  shows `builder-persistent-rounds-canary` loading through `pnpm kota eval list`.
- `.kota/runs/2026-05-28T00-17-41-884Z-builder-mzgzz3/multi-round-fixture-evidence/builder-persistent-rounds-canary-0/fixture-run.json`
  records the new fixture as one passing run with both rounds passing and
  aggregate objective metric value `1`.
