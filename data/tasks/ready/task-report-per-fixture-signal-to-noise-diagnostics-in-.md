---
id: task-report-per-fixture-signal-to-noise-diagnostics-in-
title: Report per-fixture signal-to-noise diagnostics in eval-harness aggregates
status: ready
priority: p2
area: modules
summary: Extend eval-harness aggregate artifacts with per-fixture reliability and signal-to-noise diagnostics so low-signal fixtures are explicit redesign candidates rather than hidden inside the global pass@k/pass^k score.
created_at: 2026-05-28T02:46:24.599Z
updated_at: 2026-05-28T02:46:24.599Z
---

## Problem

KOTA's eval harness reports the right aggregate distinction between `pass@k`
and `pass^k`, and its regression gate compares aggregate `pass^k` against a
stable resource profile and noise band. That still leaves a blind spot at the
fixture level: an eval set can show a weak or changed aggregate score without
making it obvious which fixtures are reliable discriminators, which fixtures
are unstable under repeated runs, and which fixtures should be redesigned
before their noise distorts future cadence decisions.

Today `scorePerFixture` records only `passedAny`, `passedAll`, and an observed
pass rate. The `eval-set-report.json` therefore has enough data for aggregate
math but not enough operator-facing diagnosis. A fixture with outcomes
`pass, fail, fail` and a fixture with `pass, pass, fail` both affect the
aggregate, but neither is explicitly labeled as repeat-unstable or low-signal.
The cadence baseline can decide "gate / not gate"; it cannot tell an operator
"this fixture is the noise source, rerun or redesign it."

Recent benchmark methodology work makes the gap concrete: ClawBench's Core v1
release foregrounds reliability metrics, per-task variance decomposition,
seed-noise vs capability-signal ratios, and low-signal task pruning. KOTA
should not import ClawBench or add a second benchmark runner, but the local
eval harness should expose the same class of diagnostic evidence from its own
run artifacts.

## Desired Outcome

Eval-set reports include a typed fixture-diagnostics section derived from the
same `FixtureRun[]` already used for scoring. For each fixture, the report
surfaces:

- the ordered run outcome vector and outcome counts;
- observed pass rate and repeat variance for the current `k`;
- a strict diagnostic class such as `stable-pass`, `stable-fail`, or
  `repeat-unstable`;
- a low-signal warning when a fixture has mixed repeat outcomes at the gating
  repeat count;
- aggregate counts of stable-pass, stable-fail, repeat-unstable, and
  non-gating/insufficient-sample diagnostics.

CLI and JSON/HTTP callers surface the same diagnostic summary without adding a
new metrics store. Cadence keeps using aggregate `pass^k` for gating, but the
artifact and operator output make noisy fixtures visible so future queue work
can redesign or split them deliberately.

## Constraints

- Keep scoring, fixture diagnostics, and report emission inside
  `src/modules/eval-harness/`. Do not add a parallel benchmark runner, ranking
  store, or ClawBench import.
- Keep exact formulas and diagnostic labels in code and focused tests. Durable
  docs should only mention the high-level contract if a local `AGENTS.md`
  boundary changes.
- Do not claim true cross-model or cross-harness signal-to-noise unless the
  implementation actually has comparable historical data for that calculation.
  When only one repeated eval set is available, label the evidence as
  repeat-variance / repeat-instability.
- Preserve the existing `pass@k` / `pass^k` aggregate semantics and regression
  gate. Diagnostics are explanatory evidence, not a replacement for the gate.
- Keep `k=1` honest: it can report insufficient sample evidence, not fixture
  stability.
- Do not leak cost or model-choice optimization into agent-facing context.

## Done When

- A strict `FixtureDiagnostics` type is computed from `FixtureRun[]` or
  `FixtureScore[]` and written into `eval-set-report.json`.
- The diagnostics include per-fixture outcome vectors/counts, observed pass
  rate, repeat variance, diagnostic class, and machine-readable warnings.
- Aggregate diagnostic counts are available to CLI/HTTP/cadence callers through
  the existing eval-set report shape.
- The human CLI output highlights repeat-unstable fixtures when present while
  keeping the current `pass@k` / `pass^k` summary intact.
- Existing baseline and regression-gate behavior remains unchanged except that
  the candidate run artifact now contains the extra diagnostic evidence.
- Focused tests cover stable pass, stable fail, mixed repeat outcomes, and
  `k=1` insufficient-sample behavior.

## Source / Intent

Explorer run `2026-05-28T02-44-24-147Z-explorer-0jdt0w` received an empty
actionable queue: `ready=0`, `doing=0`, and both backlog tasks are hard
dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`. The surfaced
strategic blocked alternatives all still require operator-captured evidence
and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://github.com/openclaw/clawbench` — ClawBench Core v1 describes a
  reproducibility-first agent benchmark with trace-based scoring, reliability
  metrics, per-task variance decomposition, seed-noise vs capability-signal
  ratios, and dropping low-SNR tasks from the public core set.

Local overlap check:

- `src/modules/eval-harness/AGENTS.md` already documents aggregate
  `pass@k` / `pass^k`, resource profiles, repeat count, and the noise-band
  regression gate.
- `src/modules/eval-harness/scoring.ts` computes `passedAny`, `passedAll`, and
  `observedPassRate` per fixture, but no repeat-variance or diagnostic class.
- `src/modules/eval-harness/eval-set.ts` writes `runs`, `perFixture`,
  `aggregate`, control-decision coverage, and objective metrics to
  `eval-set-report.json`; there is no fixture-level reliability diagnostic
  section.
- Repository search found no open ClawBench task or existing task for
  per-fixture seed-noise diagnostics.

## Initiative

Autonomy eval harness: KOTA should make noisy or low-signal fixtures explicit
in run artifacts so regression gates and future fixture design are grounded in
repeatable evidence, not only aggregate pass/fail movement.

## Acceptance Evidence

- Focused scoring/eval-set tests pass, including fixtures with all-pass,
  all-fail, mixed repeat outcomes, and `k=1`:
  `pnpm test src/modules/eval-harness/scoring.test.ts src/modules/eval-harness/eval-set.test.ts`.
- CLI-focused tests or a captured transcript under `.kota/runs/<run-id>/`
  shows `pnpm kota eval run --repeats 3` printing the unchanged aggregate
  summary plus repeat-unstable fixture diagnostics.
- The produced `eval-set-report.json` contains the new fixture diagnostics and
  aggregate diagnostic counts in a strict typed shape.
