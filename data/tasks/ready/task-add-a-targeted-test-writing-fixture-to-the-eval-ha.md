---
id: task-add-a-targeted-test-writing-fixture-to-the-eval-ha
title: Add a targeted test-writing fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder writes precise production-style tests for existing behavior without product-code edits, using mutation-style checks and placement/convention predicates so test-writing quality is artifact-graded.
created_at: 2026-05-29T12:34:48.216Z
updated_at: 2026-05-29T12:34:48.216Z
---

## Problem

KOTA's builder eval fixtures now cover implementation fixes, no-op restraint,
scope restraint, full-cycle bare-repo setup, black-box behavior
reconstruction, empirical optimization, product-requirements canaries,
scientific-claim reproduction, and evaluation-authoring restraint. They still
do not isolate a common professional engineering task: writing precise tests
for behavior that already works, without changing production code.

That gap matters because test-writing failures are different from
implementation failures. A builder can pass an ordinary coding fixture by
patching the product code, or can pass a full-cycle fixture by adding tests as
part of a larger implementation repair. KOTA does not yet have a fixture where
the only acceptable change is a focused test patch that proves existing
behavior through the repository's conventions and catches deterministic
regressions.

SWE Atlas Test Writing and OmniCode both make this failure mode concrete:
coding agents underperform on test generation, often miss required cases, put
tests in the wrong bucket, or add broad unrelated tests that do not target the
requested behavior. KOTA should not import those benchmark runners, but it
should carry one compact local fixture that grades targeted test-writing as an
artifact rather than as a prose claim.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small local
project whose product behavior is already correct but under-tested. The
builder must add precise tests for a high-level behavior description and leave
machine-readable evidence of what tests were added.

The fixture should make test-writing quality observable:

- The initial tree contains an existing source module, an existing nearby test
  bucket with helpers or conventions, and a task describing the behavior to
  cover at a high level.
- The builder-facing task asks for tests only. Product/source code, runner
  scripts, and verifier code are not legitimate edit targets.
- The submitted tests pass on the unmutated baseline and fail against
  deterministic behavior mutations selected by the fixture.
- A small manifest or equivalent artifact lists the tests the builder added so
  the scorer can run only the relevant tests and detect broad unrelated test
  additions.
- Final predicates inspect test placement, command output, mutation results,
  task movement, and changed paths rather than trusting the builder's summary.

## Constraints

- Use the existing eval-harness fixture, predicate, subprocess, objective
  metric, and replay paths. Do not import SWE Atlas, Harbor, Modal, OmniCode,
  a benchmark runner, or an LLM judge.
- Keep the project tiny, deterministic, and local. The fixture must run
  without network access, external services, Docker images, large dependencies,
  or provider calls when replay-backed.
- The fixture must reject production-code edits, test-runner edits, generated
  snapshots that simply encode current output, and broad test spam that passes
  the baseline but does not fail targeted mutations.
- Mutation checks must be deterministic and inspectable in the fixture tree.
  They should encode a few behavior regressions the requested tests must catch,
  not a hidden external benchmark.
- Test placement and conventions should be checked with source artifacts where
  practical: use an existing test file or local helper pattern, require stable
  test names or markers, and reject misplaced new test buckets when the local
  convention is clear.
- Keep pass/fail predicate-based. Objective metrics such as number of
  mutations caught may be reported as evidence but must not replace explicit
  predicates.
- Keep this out of ordinary `pnpm test` unless it is replay-backed. A
  deterministic replay-backed eval run is acceptable evidence; a live-builder
  run is not required for the first slice.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-targeted-test-writing/` exists
  with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the test-writing-only outcome and acceptance
  evidence.
- The seeded product code is behaviorally correct before the builder runs, but
  the fixture fails because required tests and the test manifest/evidence are
  absent.
- Final predicates require the task to move to `done/`, the targeted tests to
  pass on the baseline, the deterministic mutations to be caught, the manifest
  or equivalent test list to be present, and git changes to stay within the
  accepted test/task evidence files.
- The scorer rejects at least three shortcuts: editing product code instead of
  tests, adding unrelated tests that do not fail the targeted mutations, and
  placing tests in a new/wrong bucket when an existing test bucket should be
  extended.
- The fixture records an objective metric such as `mutations_caught` through
  the existing objective-metric path.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes
  deterministically, using replay if needed, with the test-writing predicates
  passing and the objective metric visible in the run artifact and aggregate
  output.

## Source / Intent

Explorer run `2026-05-29T12-32-01-716Z-explorer-mlzn0d` reviewed a zero
actionable queue. The strategic blocked alternatives were all legitimate
operator-capture waits and not movable, so the queue needed a new strategic
module-first task rather than client fan-out or another operator-capture
dependent slice.

External sources checked:

- `https://labs.scale.com/leaderboard/sweatlas-tw` describes SWE Atlas Test
  Writing as a benchmark for production-grade test authoring where agents must
  explore a repository, place focused tests, provide a manifest, and pass
  mutation-style checks. It reports that frontier systems still score below
  45% and that over-broad tests can correlate with mutation failures.
- `https://github.com/scaleapi/SWE-Atlas` is the open-source data and runner
  repository for Codebase QnA, Test Writing, and Refactoring. KOTA should
  monitor it as methodology input, not vendor its runner.
- `https://arxiv.org/abs/2602.02262` describes OmniCode, which includes test
  generation among its four coding-agent task categories and reports that
  agents lag on test-generation tasks compared with narrower bug-fixing work.

Local overlap check:

- `builder-bare-repo-full-cycle` requires verification-test generation while
  also reconstructing setup and fixing product code; it does not isolate a
  tests-only patch where product code must remain untouched.
- `builder-eval-authoring-restraint` covers authoring an evaluator for agent
  traces, not writing production-style tests inside an existing codebase.
- Harness-parity has refactor and discovery scenarios plus retrieval
  diagnostics, but those are side-by-side harness artifacts rather than an
  outcome-graded builder fixture with mutation checks.

The nonduplicative local gap is a compact test-writing-only fixture that
checks whether the builder can add precise, placed tests for existing behavior
and prove their relevance through deterministic mutations.

## Initiative

Outcome-grade autonomy evaluation: KOTA should grade not only whether builders
can change code, but whether they can add focused tests that protect existing
behavior without hiding behind implementation edits, broad test spam, or prose
claims.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, test manifest contract, mutation
  scorer, and calibration/shortcut evidence.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  baseline test pass, mutation-catching predicates, and objective metric in
  the output.
- Run artifact from the same eval execution showing predicate details,
  mutation-check output, changed-path enforcement, and the objective metric
  value.
