---
id: task-add-a-black-box-behavior-reconstruction-fixture-to
title: Add a black-box behavior reconstruction fixture to the eval harness
status: blocked
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must infer a small CLI's behavior from an executable and docs, then implement a fresh source tree that passes deterministic behavioral tests without source lookup or network access.
created_at: 2026-05-26T05:44:02.548Z
updated_at: 2026-05-26T06:36:06.000Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
structured trajectories, trajectory diagnostics, replayed workflow steps, and a
measured empirical-code optimization task. They still do not exercise a
different coding-agent failure mode: systematically discovering an unknown
program's behavior and implementing a fresh compatible program from
observations instead of from source.

ProgramBench is a current primary-source signal for this gap. It evaluates
agents that receive only an executable plus documentation and must build a new
codebase that matches the reference behavior. The relevant KOTA lesson is not
to import a large benchmark or copy its reverse-engineering rules wholesale; it
is to add one small local fixture that checks whether builder can turn black-box
behavior exploration into deterministic implementation evidence.

## Desired Outcome

Add one shipped eval-harness fixture where the builder sees a compact CLI
reference executable and documentation, but not the implementation source, and
must write a fresh source tree whose executable matches deterministic
behavioral tests.

The fixture should make behavior discovery observable and artifact-graded:

- The materialized `initial/` tree contains the task, minimal project
  scaffolding, docs/help text, a reference executable or oracle wrapper, and a
  candidate stub that fails the tests.
- The reference implementation source is not copied into the fixture working
  directory. If the oracle is generated from source, the generation source and
  regeneration notes live outside `initial/` so maintainers can rebuild it, but
  eval runs expose only the executable behavior.
- The scoring script compares the submitted candidate against the reference on
  fixed and generated cases, including at least one edge case that a naive
  hardcoded solution would miss.
- Pass/fail remains predicate-based, with any numeric behavioral coverage or
  mismatch count reported as optional objective-metric evidence.
- The fixture stays small enough to be a live-builder canary, not a new
  benchmark suite.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add a ProgramBench runner, a benchmark
  importer, a new metrics store, or a second fixture setup DSL unless the
  existing materialization path truly cannot hide the oracle source.
- Keep the reference program tiny and local. The fixture must run without
  network access, external services, large dependencies, Docker images, or
  platform-specific host assumptions.
- The task must ask for a fresh implementation from observed behavior. It must
  explicitly forbid copying source, wrapping the reference executable, or making
  the final candidate depend on the oracle at runtime.
- The scoring script must reject obvious shortcuts, including a candidate that
  shells out to the reference executable, copies the oracle artifact, or passes
  only the fixed examples while failing generated cases.
- Keep hidden tests deterministic and inspectable in the fixture tree. Do not
  make the evaluator depend on the builder's summary or on an LLM judge.
- If binary artifacts are committed, keep them minimal and document how to
  regenerate them. If an equivalent source-hidden oracle can be achieved with
  plain text tooling, prefer that.
- Keep this out of `pnpm test` unless it is replay-backed. A live-builder
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-black-box-behavior-reconstruction/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the black-box behavior-reconstruction outcome and
  acceptance evidence.
- The initial candidate implementation fails the behavioral scorer before the
  builder runs, and `preRunExpectations` include that expected failure.
- The final predicates require the task to move to `done/`, the behavioral
  scorer to pass, and git changes to stay within the candidate implementation
  and task files.
- The scorer includes both fixed examples and deterministic generated cases,
  and rejects any candidate that invokes or copies the reference oracle.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the behavior predicate passing and any objective metric visible in the run
  artifact and aggregate output.
- A temporary local shortcut, such as editing the candidate to delegate to the
  oracle, causes the fixture to fail, then is reverted before completion.

## Source / Intent

Explorer run `2026-05-26T05-41-00-044Z-explorer-pvetla` reviewed an empty
actionable queue. The strategic blocked alternatives were all real
operator-capture waits and not movable, so a focused eval-harness slice is
preferable to declaring no-op or opening client fan-out work.

External sources checked:

- `https://github.com/SWE-agent/mini-swe-agent` now points to ProgramBench as a
  high-signal benchmark runner for mini-SWE-agent.
- `https://programbench.com/` describes ProgramBench as a 200-task benchmark
  where agents receive a compiled executable and documentation, then rebuild a
  matching program from scratch under behavioral tests.
- `https://github.com/facebookresearch/programbench` is the project repository.
- `https://arxiv.org/abs/2605.03546` frames the benchmark as measuring
  holistic software development from a program and documentation rather than a
  narrowly specified bug fix.

KOTA already has trajectory evidence, no-op and scope-expansion restraint, and
one empirical-code optimization fixture. The remaining KOTA-relevant gap is a
small black-box behavior-reconstruction fixture that validates systematic
behavior discovery and clean implementation through artifacts.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test not only whether a builder
can patch known source, but whether it can infer and reproduce a small
program's behavior from executable observations without relying on source
lookup, wrappers, or prose claims.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and any oracle regeneration notes.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  behavior predicate passing and any objective metric in the output.
- Run artifact from the same eval execution showing predicate details,
  behavioral scorer output, and any objective metric values.
- Evidence of a temporary shortcut/regression causing the fixture to fail,
  with the regression reverted before staging.

## Current Evidence

- `.kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/eval-list-transcript.txt`
  shows the fixture loads without the replay tag.
- `.kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/eval-run-transcript.txt`
  shows normal eval execution now reaches the live builder agent step without
  the eval-harness replay adapter active. In this sandbox the run stops at
  `codex_cli_error` because the Codex harness cannot reach
  `https://api.openai.com/v1/responses`; the required passing live-builder
  transcript remains outstanding.
- `.kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/eval-run-artifacts/fixture-run.json`
  records the same non-replay live attempt. The run outcome is `error`, the
  behavior scorer still fails against the untouched stub, and
  `behavior_mismatches` is nonzero because the builder step did not complete.
- `.kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/black-box-fixture-test-transcript.txt`
  shows the focused regression test passing. The test asserts this fixture has
  no agent-step recordings, the runner does not set `replayRecordingsRoot`, and
  the scorer rejects a behaviorally correct candidate that embeds the oracle
  artifact and instantiates it with `WebAssembly`.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/eval-live-pass
description: network-enabled operator runs `pnpm kota eval run --fixture builder-black-box-behavior-reconstruction --repeats 1 > .kota/runs/2026-05-26T05-48-30-948Z-builder-char3h/eval-live-pass/transcript.txt 2>&1` with a live agent harness that can reach https://api.openai.com/v1/responses, then records or copies the matching `.kota/eval-runs/<stamp>/builder-black-box-behavior-reconstruction-0/fixture-run.json` under the same directory showing pass^k=100.0%, outcome `pass`, `behavior_mismatches` equal to 0, and the behavior scorer predicate passing. The current sandbox reaches the live builder step but fails with `codex_cli_error` before implementation is exercised.
```
