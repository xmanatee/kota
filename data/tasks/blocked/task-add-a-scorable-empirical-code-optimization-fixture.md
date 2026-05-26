---
id: task-add-a-scorable-empirical-code-optimization-fixture
title: Add a scorable empirical-code optimization fixture to the eval harness
status: blocked
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder improves a small empirical-code task against a deterministic objective metric, proving optimization-shaped autonomy work is measured by artifacts rather than prose.
created_at: 2026-05-26T02:23:09.307Z
updated_at: 2026-05-26T02:38:56.959Z
---

## Problem

KOTA can now report objective metrics from eval fixtures, but the shipped
fixture set still does not exercise the agent shape that motivated the feature:
a builder improving empirical code against a deterministic score. The current
objective-metric smoke fixture counts a marker file, which proves plumbing, not
that autonomy can handle a small optimization task where the meaningful outcome
is a measured error, quality, or efficiency value.

Google Research's May 19, 2026 ERA update is a current primary-source example
of this class of agent work: the agent is given a problem plus a measure of
success, writes and refines code, and evaluates many candidate solutions against
that goal. KOTA should not import ERA's tree-search architecture, but it should
have at least one local fixture where the builder must improve code and the
artifact carries a numeric score that is inspected independently of the
agent's prose.

## Desired Outcome

Add one shipped eval-harness fixture that gives the builder a compact
empirical-code optimization task and verifies the result through deterministic
artifacts:

- The initial fixture contains a small self-contained code problem with a
  deliberately weak baseline implementation and a scoring script that writes a
  numeric metric.
- The builder-facing task asks for a real improvement against that score, not
  a cosmetic edit or a marker file.
- The fixture records an `objectiveMetrics` entry for the score and uses an
  explicit predicate, such as `shell-succeeds`, to turn a deterministic
  threshold into pass/fail evidence.
- The fixture remains small enough for the normal cadence path and is excluded
  from the `pnpm test` replay smoke gate because it requires a live builder
  agent call.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add a benchmark runner, metrics database,
  or ERA-style search engine.
- Keep the scenario deterministic and local. The scoring script must run
  without network access, external services, or large dependencies.
- Use a small empirical task where overfitting is visibly discouraged. For
  example, provide training data plus hidden/holdout rows in the fixture and
  score against the holdout path, or use deterministic generated data with a
  fixed seed.
- The score must come from code or artifacts in the fixture working directory,
  never from the builder's final summary.
- Preserve the eval-harness contract: pass/fail still comes from predicates;
  objective metrics are reported evidence unless the fixture adds a predicate
  that encodes the threshold.
- Do not add the live-LLM fixture to `src/modules/eval-harness/replay-smoke.test.ts`
  or any standard `pnpm test` path.
- Keep AGENTS.md documentation high-level. Update it only if the existing
  eval-harness guidance is inaccurate or missing the live-fixture vs smoke-gate
  boundary.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-empirical-code-optimization/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the optimization outcome and acceptance evidence.
- The fixture declares at least one objective metric, for example
  `forecast_mae` or `prediction_error`, with `direction: "lower_is_better"` and
  a deterministic source.
- The fixture includes a pass/fail predicate that fails on the seeded baseline
  and passes only after the builder improves the implementation enough to meet
  the score threshold.
- `preRunExpectations` include at least one expected failure proving the metric
  threshold is non-vacuous before the agent runs.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the predicate passing and the numeric objective metric visible in the run
  artifact and aggregate output.
- A temporary local regression to the scoring script or implementation causes
  the fixture to fail, then is reverted before completion.

## Source / Intent

Explorer run `2026-05-26T02-20-24-653Z-explorer-z5ohp1` reviewed a builder-empty
queue. The strategic blocked alternatives were all real operator-capture waits
and not movable, so opening a focused eval-harness slice is preferable to
declaring no-op or creating client fan-out work.

Research source: Google Research's "Empirical Research Assistance (ERA): From
Nature publication to catalyzing Computational Discovery" (May 19, 2026)
describes ERA as a scientific-coding system that writes and optimizes code
against a measure of success:
https://research.google/blog/empirical-research-assistance-era-from-nature-publication-to-catalyzing-computational-discovery/

Companion source: the `google-research/era` applications directory describes
ERA as writing, optimizing, executing, and rigorously evaluating empirical
software across real scientific applications:
https://github.com/google-research/era/tree/main/era_applications

KOTA already rejected verbal self-reflection/strategy-bank memory patterns and
already shipped objective metric reporting. The remaining KOTA-relevant gap is
not a new agent primitive; it is an executable fixture that proves measurable
optimization work is artifact-graded.

## Initiative

Outcome-grade autonomy evaluation: optimization-shaped autonomy work should be
validated by deterministic artifacts and numeric evidence inside the existing
eval-harness path, without adding a parallel benchmark system or weakening the
predicate-based regression gate.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  and the minimal `initial/` project/task files.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing
  `pass^k=100.0%` and the objective metric value in the output.
- Run artifact from the same eval execution showing the metric source,
  observed numeric value, and predicate details.
- Evidence of the temporary regression check failing the fixture, with the
  regression reverted before staging.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-05-26T02-25-55-490Z-builder-z5wble/eval-live-pass
description: network-enabled operator runs `pnpm kota eval run --fixture builder-empirical-code-optimization --repeats 1 > .kota/runs/2026-05-26T02-25-55-490Z-builder-z5wble/eval-live-pass/transcript.txt 2>&1` with a live agent harness that can reach https://api.openai.com/v1/responses, then records or copies the matching `.kota/eval-runs/<stamp>/builder-empirical-code-optimization-0/fixture-run.json` under the same directory showing pass^k=100.0% and the `forecast_mae` objective metric. The current sandbox fails the live builder call before implementation is exercised.
```
