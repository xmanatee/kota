---
id: task-add-an-eval-authoring-restraint-fixture-to-the-eva
title: Add an eval-authoring restraint fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must add one focused executable evaluation for a small agent or tool requirement without overengineering metrics or passing through prose-only artifacts.
created_at: 2026-05-26T22:50:16.902Z
updated_at: 2026-05-26T22:50:16.902Z
---

## Problem

KOTA has an eval harness for autonomy behavior, but its shipped fixtures mostly
score whether a builder changed product code correctly. They do not directly
exercise a recurring meta-work shape: asking the builder to author a focused,
executable evaluation for an agent/tool behavior without turning it into a
large metric bundle, a prose report, or a brittle checklist that passes without
running meaningful cases.

AgentEvalBench is a current primary-source signal for this gap. Its paper
reports that frontier coding assistants, when asked to automate agent
evaluation without domain-specific evaluation guidance, only reached a 30%
execution success rate and tended to produce over-broad evaluations averaging
more than 12 metrics per agent. The KOTA lesson is not to import EvalAgent or
add a second evaluation pipeline; it is to make eval-authoring quality
artifact-graded inside the existing eval-harness path.

## Desired Outcome

Add one shipped eval-harness fixture where the builder must author a small,
focused, executable evaluation for a deterministic local agent/tool scenario.
The fixture should make evaluation quality inspectable:

- The materialized `initial/` tree contains a tiny deterministic agent or tool
  runner, seeded good and bad traces/cases, and concise evaluation
  requirements.
- The builder-facing task asks for evaluation code and fixtures only; it must
  not solve the agent behavior by changing the runner under test.
- The resulting evaluation command succeeds on the good cases, fails or
  reports the expected violation on the bad cases, and writes a bounded
  machine-readable result.
- Metric vocabulary stays intentionally small and tied to the stated
  requirements, for example pass/fail plus at most a few requirement-specific
  counts. Metric sprawl should fail the fixture.
- Final predicates inspect files, command output, and result artifacts rather
  than the builder's summary.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add an EvalAgent clone, a benchmark
  importer, a second evaluation DSL, or a parallel metrics store.
- Keep the scenario deterministic and local. The evaluation must run without
  network access, external services, large dependencies, or an LLM judge.
- Evaluation guidance belongs in the fixture task/docs as domain requirements,
  not as a new runtime skill store or injected summary surface.
- The fixture must reject prose-only evaluation, excessive metrics, and
  evaluators that do not distinguish the seeded good and bad cases.
- Preserve the eval-harness contract: pass/fail comes from predicates;
  objective metrics are reported evidence unless a predicate explicitly encodes
  a threshold.
- Keep this out of `pnpm test` unless it is replay-backed. A live-builder
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-eval-authoring-restraint/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the evaluation-authoring outcome and acceptance
  evidence.
- The initial tree includes at least one good case and one bad case whose
  distinction is required by the evaluator.
- The seeded baseline fails before the builder runs because the evaluation
  command or result artifact is absent or insufficient, and
  `preRunExpectations` record that expected failure.
- Final predicates require the task to move to `done/`, the evaluation command
  to run successfully, the bad case to be caught, the good case to pass, and
  the result artifact to stay within a bounded metric vocabulary.
- The scorer or predicates reject a prose-only evaluator, an evaluator that
  always passes, and an evaluator that emits unrelated metric sprawl.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the evaluation predicates passing and any objective metric visible in the run
  artifact and aggregate output.
- Temporary local regressions for "always pass" and "too many metrics" cause
  the fixture to fail, then are reverted before staging.

## Source / Intent

Explorer run `2026-05-26T22-47-54-757Z-explorer-0sknqa` reviewed a thin
queue. The ready queue had two real security-review findings, and the strategic
blocked alternatives were all operator-capture waits, so a focused
eval-harness slice is preferable to opening client fan-out work or declaring
the queue healthy.

Primary source checked:

- `https://arxiv.org/abs/2605.11378` — "An Empirical Study of Automating Agent
  Evaluation" (submitted May 12, 2026). The abstract reports that simply
  prompting frontier coding assistants was insufficient for agent-evaluation
  authoring, with only 30% execution success and over-engineered evaluations
  averaging more than 12 metrics per agent. It also reports that evaluation
  skills and trace-based artifacts improved Eval@1, which maps to KOTA as
  fixture-local requirements and executable artifacts rather than a new
  evaluation-agent primitive.

Blocked strategic alternatives considered but not chosen for this run were
real operator-capture waits:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

## Initiative

Outcome-grade autonomy evaluation: KOTA should grade not only whether builders
produce working code, but whether they can author narrow, executable
evaluations whose evidence is meaningful on the first run and resistant to
metric sprawl or prose-only success claims.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, seeded good/bad cases, and the
  evaluation-result contract.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  evaluation predicates passing.
- Run artifact from the same eval execution showing predicate details,
  evaluation command output, and any objective metric values.
- Evidence of temporary "always pass" and metric-sprawl regressions failing the
  fixture, with both regressions reverted before staging.
