---
id: task-add-spec-conditioned-protocol-compliance-fixture
title: Add spec-conditioned protocol compliance fixture to eval harness
status: done
priority: p2
area: modules
task_class: Platform
summary: Seed a replay-backed eval-harness fixture where the builder must fix protocol edge cases from a concise normative spec excerpt, so spec-dependent implementation quality is artifact-graded instead of blended into ordinary tests.
created_at: 2026-06-21T03:52:34.000Z
updated_at: 2026-06-21T04:14:01.000Z
---

## Problem

KOTA's builder fixtures now cover no-op restraint, scope restraint, black-box
behavior reconstruction, empirical optimization, product canaries,
multi-service integration, targeted test writing, dialogue-driven coding,
scientific reproduction, and unfamiliar-rule strategy construction. They still
do not isolate a common KOTA-shaped failure mode: a builder receives a compact
normative protocol excerpt, must apply the spec to edge cases, and must prove
the implementation is spec-compliant rather than merely passing visible tests
or guessing from familiar defensive-code patterns.

That gap matters because much of KOTA's platform work is protocol work: MCP,
ACP, A2A, daemon control, workflow events, and external adapters all depend on
strict boundary behavior. KOTA should test whether builders can use a small
spec document as load-bearing implementation context without importing a large
external benchmark or trusting final prose.

## Desired Outcome

Add one replay-backed eval-harness fixture where the builder receives a tiny
local protocol implementation, a concise fixture-owned `SPEC.md`, and a
normalized ready task. The builder must repair spec-dependent edge cases and
write structured compliance evidence such as `spec-compliance-result.json`
containing:

- the spec clause ids exercised;
- the local verification command;
- counts or names for generic defensive cases and spec-dependent cases;
- the changed implementation paths; and
- enough provenance for the scorer to verify the result came from local tests
  and the spec excerpt, not a hardcoded visible sample.

The fixture should make spec-conditioned implementation observable:

- The initial tree includes a deliberately incomplete protocol handler plus a
  compact normative spec with at least three clause ids.
- Some visible tests should be generic defensive checks, while hidden or
  scorer-owned cases require applying the spec-specific clauses.
- Final predicates verify the task moved to `done/`, the protocol verifier
  passes, `spec-compliance-result.json` is well-formed, and the implementation
  did not edit the spec, verifier, fixture metadata, or unrelated product
  files.
- An optional objective metric such as `spec_dependent_cases_passed` is
  reported through the existing objective-metric path while pass/fail remains
  predicate-based.

## Constraints

- Use the existing eval-harness fixture, replay, predicate, objective-metric,
  verifier-calibration, and subprocess execution paths. Do not add a benchmark
  runner, telecom/5G importer, protocol-specific runtime, LLM judge, or second
  fixture setup DSL.
- Keep the protocol tiny, deterministic, and local. The fixture must run
  without network access, external services, Docker images, large dependencies,
  live model calls, or platform-specific tooling.
- The spec should be fixture-owned and protocol-shaped, not a copied MCP, ACP,
  A2A, or telecom standard. It may be inspired by normative protocol work, but
  the scenario and data must be KOTA-owned.
- Use a replay-backed smoke fixture for the first slice so `pnpm kota eval run`
  remains deterministic in this environment. A live nested builder pass is not
  required to complete this task.
- The scorer must reject obvious shortcuts: editing the spec or verifier,
  hardcoding only visible samples, ignoring clause ids in the compliance
  artifact, writing a prose-only report, or replacing the protocol handler with
  an unrelated special-case script.
- If the answer space is broad enough to risk overspecific scoring, include a
  meaningful `acceptedAlternatives` calibration case; otherwise document why
  null/golden/adversarial calibration is sufficient.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-spec-conditioned-protocol-compliance/`
  exists with `fixture.json`, `notes.md`, `recordings/`, and a minimal
  `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the spec-conditioned protocol-compliance outcome
  and acceptance evidence.
- The seeded initial project fails before the replayed builder run because the
  implementation and compliance artifact are incomplete, and
  `preRunExpectations` record those expected failures.
- Final predicates require the task to move to `done/`, the verifier command to
  pass generic and spec-dependent cases, `spec-compliance-result.json` to
  contain the required clause and result fields, and git changes to stay within
  the accepted implementation, artifact, test, and task paths.
- Verifier calibration or focused tests prove shortcut candidates fail,
  including hardcoded visible samples, missing clause evidence, and spec or
  verifier edits.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes
  deterministically through replay with the protocol-compliance predicates
  passing and any objective metric visible in the run artifact and aggregate
  output.

## Source / Intent

Explorer run `2026-06-21T02-57-00-757Z-explorer-0uqijg` reviewed a thin queue:
one actionable `p3` ready item, no backlog, and
`inspect-queue.strategicReadyCoverageGap=true`. The strategic blocked
alternatives all still require operator-captured evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2604.26278` ("SWE-Bench 5G: Benchmarking AI Coding
  Agents on Telecom Network Engineering Tasks", submitted April 29, 2026)
  packages real 5G-core bug tasks with automated fail-to-pass tests and adds
  concise specification-context documents for issues that reference 3GPP
  clauses. The abstract reports that models diagnose many bugs but resolve far
  fewer, and that specification excerpts improve results for
  specification-dependent bugs more than for generic defensive checks.

Local overlap check:

- `builder-product-requirements-canary` grades rich product requirements and
  follow-up policy preservation, not normative protocol clauses with
  spec-dependent edge cases.
- `builder-multi-service-integration` grades local route wiring between two
  components, not applying a spec excerpt to protocol semantics.
- `builder-unfamiliar-language-strategy-construction` grades learning a tiny
  execution rule system, not fixing a familiar implementation from normative
  protocol text.
- Existing MCP/ACP/A2A tasks validate concrete KOTA protocol surfaces one at a
  time, but they do not give the eval harness a reusable builder capability
  fixture for spec-conditioned implementation.

The nonduplicative local gap is a compact replay-backed fixture that grades
whether a builder can turn a concise protocol spec into correct edge-case
behavior and inspectable compliance evidence.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test protocol/spec-conditioned
builder work as a first-class platform capability, without importing external
benchmarks or trusting self-reported reasoning.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, verifier, recording, calibration,
  and `spec-compliance-result.json` contract.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  spec-conditioned predicates passing through replay.
- Run artifact from the same eval execution showing predicate details,
  generic and spec-dependent case results, clause ids, changed-path
  enforcement, and any objective metric values.
- Evidence of shortcut calibration or focused self-tests failing hardcoded,
  missing-clause, and spec/verifier-edit candidates, with temporary regressions
  reverted before staging.

## Result

Added the replay-backed
`builder-spec-conditioned-protocol-compliance` eval fixture with a local Window
Envelope Protocol spec, verifier calibration, replay recordings, shortcut
self-tests, structured compliance artifact contract, and
`spec_dependent_cases_passed` objective metric.

## Evidence

- `.kota/runs/2026-06-21T04-01-08-375Z-builder-gwz8i6/eval-list-transcript.txt`
  shows `pnpm kota eval list` loading the fixture.
- `.kota/runs/2026-06-21T04-01-08-375Z-builder-gwz8i6/eval-run-transcript.txt`
  shows `pnpm kota eval run --fixture builder-spec-conditioned-protocol-compliance --repeats 1`
  passing through replay with pass@k=100.0%, pass^k=100.0%, and
  `spec_dependent_cases_passed mean=4.000`.
- `.kota/eval-runs/2026-06-21T04-13-28-171Z` contains the run artifact,
  predicate details, verifier calibration, and objective metric output.
