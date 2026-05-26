---
id: task-add-a-bare-repository-full-cycle-builder-fixture
title: Add a bare-repository full-cycle builder fixture
status: done
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder starts from a bare project, reconstructs the runnable environment, writes verification tests, and fixes the implementation so full-cycle setup and test-generation failures become artifact-graded.
created_at: 2026-05-26T19:26:50.195Z
updated_at: 2026-05-26T19:41:43.902Z
---

## Problem

KOTA's eval-harness builder fixtures now cover no-op restraint, scope
restraint, multi-point wiring, black-box behavior reconstruction, empirical
code optimization, and replayed workflow substrate. They still do not exercise
the practical full-cycle failure mode where the builder starts from a sparse
repository, must reconstruct the runnable environment, must add verification
tests, and only then can make the implementation change.

SWE-Cycle is a current primary-source signal for this gap. It reports that
preconfigured benchmarks hide real agent friction, and separates environment
reconstruction, code implementation, and verification test generation before
combining them in a FullCycle task. The KOTA-relevant lesson is not to import
SWE-Cycle or add an LLM judge; it is to add one compact local fixture that
makes setup, test-generation, and code-change success visible in artifacts.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a bare or
deliberately under-scaffolded project plus a normalized task, then must:

- reconstruct the missing runnable environment from local docs and manifests;
- add verification tests that would fail on the seeded implementation bug;
- fix the implementation; and
- leave artifact evidence that setup, tests, and implementation all happened.

The fixture should fail on the initial tree, pass only when the project can be
installed/run locally, and include predicates that prove tests were added and
executed rather than relying on the builder's final summary.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add a SWE-Cycle importer, SWE-Judge clone,
  benchmark runner, second setup DSL, or LLM evaluator.
- Keep the project tiny, deterministic, and local. It must run without network
  access, external services, large dependencies, Docker images, or
  platform-specific assumptions.
- The missing environment should be realistic but bounded, such as a minimal
  package script, lockfile/package metadata, test command, or config file that
  can be reconstructed from local instructions.
- The fixture must require verification-test generation. A candidate that only
  patches implementation code without adding the expected test coverage should
  fail.
- Keep pass/fail predicate-based. Any numeric count, such as number of tests
  executed, may be objective-metric evidence but must not replace predicates.
- Keep this out of `pnpm test` unless replay-backed. A live-builder full-cycle
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-bare-repo-full-cycle/` exists
  with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the bare-repo full-cycle outcome and acceptance
  evidence.
- The initial project cannot satisfy the final predicates before the builder
  runs; `preRunExpectations` include expected failures for the missing/runnable
  setup and behavior gate.
- Final predicates require the task to move to `done/`, the reconstructed
  runnable command to pass, the seeded implementation behavior to be correct,
  and a verification test file or test-case marker to exist.
- The fixture rejects a shortcut candidate that fixes behavior without adding
  the required verification test, and rejects a candidate that adds tests but
  leaves the runnable setup broken.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the runnable setup and behavior predicates passing, and with any objective
  metric visible in the run artifact and aggregate output.

## Source / Intent

Explorer run `2026-05-26T19-24-46-370Z-explorer-fzwkqj` reviewed a zero
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts or credentials and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source: SWE-Cycle, submitted to arXiv on May 13, 2026, evaluates code
agents across environment reconstruction, code implementation, verification
test generation, and a combined FullCycle task in a bare repository. It also
argues that preconfigured environments hide practical autonomy friction and
that full-cycle solve rates drop sharply when agents must carry cross-phase
dependencies themselves.

Research link: https://arxiv.org/abs/2605.13139

Local overlap check:

- `builder-black-box-behavior-reconstruction` covers source-hidden behavioral
  inference, not environment reconstruction and verification-test generation.
- `builder-empirical-code-optimization` covers deterministic numeric
  optimization, not bare-repo setup or test authoring.
- `builder-multi-point-wiring`, `builder-scope-expansion-restraint`, and
  `builder-noop-restraint` cover simpler work-shape and boundary failures.

The nonduplicative gap is therefore a compact full-cycle fixture that grades
setup, verification-test creation, and implementation as one artifact-backed
task.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test not only isolated source
patches, but whether the builder can turn an under-scaffolded repository into
a runnable, tested, corrected project without relying on prose claims or a
preconfigured environment.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and any deterministic scoring or
  test scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  setup, test-generation, and behavior predicates passing.
- Run artifact from the same eval execution showing predicate details and any
  objective metric values.
- Evidence of temporary shortcut regressions causing the fixture to fail, with
  the regressions reverted before staging.
