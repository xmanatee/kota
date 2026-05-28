---
id: task-add-code-health-diagnostics-to-persistent-multi-ro
title: Add code-health diagnostics to persistent multi-round eval runs
status: done
priority: p2
area: modules
summary: Extend persistent multi-round eval artifacts with deterministic code-health diagnostics for structural erosion and verbosity, so passing evolving-requirement runs can still surface maintainability degradation without importing an external benchmark.
created_at: 2026-05-28T15:13:48.743Z
updated_at: 2026-05-28T15:31:00.000Z
---

## Problem

KOTA's eval harness now supports persistent multi-round fixtures with
cumulative predicates. That catches explicit behavior regressions across
evolving task instructions, but it can still mark a run as passing while the
agent solves each round by bloating the codebase, concentrating complexity in a
few files/functions, or duplicating logic that will make the next round harder.

The existing trajectory diagnostics cover process quality such as missing
verification, repeated failing commands, and edit-after-pass ordering. They do
not inspect the resulting source tree. Objective metrics can report numeric
values, but no shipped eval-harness path derives code-health diagnostics from
the workspace before and after each persistent round.

That leaves a blind spot for exactly the failure shape persistent rounds are
meant to expose: the final tests can pass while maintainability degrades across
rounds.

## Desired Outcome

Persistent multi-round eval runs can emit deterministic code-health diagnostics
beside their behavioral pass/fail evidence. A fixture author should be able to
declare the tracked source surface, and the run artifact should show baseline
and per-round measurements with bounded warning codes for code growth,
duplication, and complexity concentration.

The diagnostics are operator-facing evidence by default. They should make
"passed but degraded" inspectable without replacing predicates, pass@k/pass^k,
critic verdicts, or trajectory diagnostics.

## Constraints

- Keep the implementation in `src/modules/eval-harness/`. Do not add a second
  benchmark runner, metrics database, or imported SlopCodeBench dependency.
- Use deterministic local analysis of the fixture workspace. Do not use an LLM
  judge, agent self-report, or provider-specific trajectory data.
- Make the metric vocabulary small, typed, and bounded. Good signals include
  source-size growth, duplicated implementation chunks, and largest-file or
  largest-function concentration. Avoid unbounded style linting or subjective
  maintainability prose.
- The fixture must explicitly define which files are in scope, so generated
  artifacts, lockfiles, vendored code, and fixture harness files do not skew
  diagnostics.
- Preserve existing pass/fail semantics. Code-health warnings are advisory
  unless a fixture deliberately encodes a deterministic threshold as a normal
  predicate.
- Keep cost, model choice, and external benchmark rankings out of agent-facing
  prompts and reports.

## Done When

- A typed `CodeHealthDiagnostics` or equivalent eval-harness artifact shape
  records baseline and per-round measurements for configured source globs.
- Persistent multi-round fixture runs write those diagnostics into
  `fixture-run.json` and expose compact aggregate counts in the eval-set report
  or existing CLI output surface.
- The diagnostics include stable warning codes for at least:
  - excessive source-size growth compared with baseline or the previous round;
  - duplicated implementation chunks;
  - complexity concentration in one file or function.
- A compact shipped fixture or fixture test demonstrates a run that still
  passes behavioral predicates while surfacing at least one code-health
  warning.
- Existing single-workflow fixtures continue to load and run unchanged unless
  they explicitly opt into the diagnostics.
- Focused tests cover clean/no-warning output, each warning class, excluded
  files/globs, malformed diagnostic configuration, and unchanged pass/fail
  scoring.

## Source / Intent

Explorer run `2026-05-28T15-11-26-446Z-explorer-hwrlbe` received a thin queue
with no actionable ready or doing tasks. The surfaced strategic blocked
alternatives all still require operator-captured evidence and are not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://arxiv.org/abs/2603.24755` — SlopCodeBench evaluates iterative
  coding-agent tasks where agents repeatedly extend their own solutions. Its
  current abstract reports structural erosion and verbosity increasing across
  most trajectories even when checkpoints are passed.

Local overlap check:

- `task-add-persistent-multi-round-scoring-to-the-eval-har` already added
  preserved-workspace multi-round fixture execution with cumulative
  predicates.
- `task-add-objective-metric-reporting-to-eval-fixtures` already added
  deterministic numeric objective metrics.
- `task-write-trajectory-quality-diagnostics-for-workflow-` already added
  process-quality diagnostics over KOTA-native message streams.
- Repository search found no open task for source-tree code-health diagnostics,
  structural erosion, or verbosity metrics in eval-harness artifacts.

The nonduplicative KOTA gap is not importing SlopCodeBench. It is making
KOTA's existing persistent-round eval artifacts show when passing rounds are
accumulating maintainability debt.

## Initiative

Outcome-grade autonomy evaluation: KOTA should measure whether builders
preserve maintainable source structure across evolving requirements, not only
whether each round's visible behavior still passes.

## Acceptance Evidence

- Focused tests pass for the code-health analyzer and multi-round artifact
  integration, for example:
  `pnpm test src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts src/modules/eval-harness/eval-set.test.ts`.
- A captured transcript under `.kota/runs/<run-id>/` shows the relevant eval
  fixture or focused command producing a passing behavioral result with
  code-health diagnostics present.
- A sample `fixture-run.json` under `.kota/runs/<run-id>/` includes baseline
  and per-round code-health measurements plus at least one bounded warning
  code from the new shape.

## Completion Evidence

- Added opt-in eval-harness code-health diagnostics for fixture source globs,
  with baseline/per-round measurements and bounded warning counts in
  `fixture-run.json` and eval-set/CLI aggregate output.
- Verification passed:
  `pnpm test src/modules/eval-harness/code-health-diagnostics.test.ts src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts src/modules/eval-harness/eval-set.test.ts src/modules/eval-harness/cli.test.ts src/modules/eval-harness/daemon-client.test.ts`
  and `pnpm typecheck`.
- Captured run evidence in
  `.kota/runs/2026-05-28T15-16-27-423Z-builder-wfldiy/transcript.txt` and
  `.kota/runs/2026-05-28T15-16-27-423Z-builder-wfldiy/sample-code-health-eval/code-health-sample-0/fixture-run.json`.
