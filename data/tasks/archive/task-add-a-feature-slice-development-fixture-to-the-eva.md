---
status: done
---

# Add a feature-slice development fixture to the eval harness

## Problem

KOTA's builder eval fixtures cover no-op restraint, scope restraint, targeted
test writing, multi-service integration, product-requirements retention, source
grounding, black-box behavior reconstruction, and several specialized canaries.
They still do not directly exercise a common product-engineering shape: adding
one coherent feature that spans multiple existing modules, where the correct
evidence is not one localized patch but a feature-level executable test plus
regression proof that adjacent behavior still works.

FeatureBench is a current primary-source signal for this gap. It argues that
many coding benchmarks stay bug-fix or single-PR shaped, while real feature
development often spans behavior introduced across multiple commits and
requires execution-based verification that separated features still work. KOTA
should not import FeatureBench or add an automated external task miner. The
local response is one compact fixture that makes feature-slice implementation
and adjacent regression preservation artifact-graded.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small
existing project with several named behaviors and must implement one new
feature slice that crosses module boundaries.

The fixture should make feature-level development observable:

- the initial tree includes existing passing behavior plus a missing feature
  whose correct implementation requires changes across at least two owning
  modules or layers;
- the task asks for the product behavior, not a test-only patch or a localized
  helper rewrite;
- the verifier runs targeted feature tests plus adjacent regression tests and
  writes a structured artifact such as `feature-slice-result.json` naming the
  feature behavior, regression behaviors, commands run, and files or modules
  involved;
- final predicates require the task to move to `done/`, the verifier to pass,
  the evidence artifact to contain the expected feature and regression fields,
  and the implementation to avoid hardcoded fixture-only shortcuts; and
- any objective metric, such as passing feature/regression case counts or
  touched-module coverage, is reported through the existing objective-metric
  path while pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, subprocess execution,
  calibration, and objective-metric paths. Do not add a FeatureBench importer,
  external dataset runner, automated Git-history task miner, LLM judge, or
  second fixture DSL.
- Keep the scenario tiny, deterministic, and local. It must run without network
  access, external services, Docker images, GPUs, or large dependencies.
- The fixture must test a feature slice rather than a single helper bug fix.
  A passing candidate should need to understand how existing behaviors relate
  across files or modules.
- The scorer must reject obvious shortcuts, including hardcoded expected
  outputs, skipped regression checks, deleting existing behavior, or editing
  verifier files to relax assertions.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.
- If the implementation environment cannot make a live nested agent call, do
  not mark the task done from fixture-load evidence alone. Reposition it
  honestly with a typed operator-capture precondition for the live pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-feature-slice-development/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/`, is valid under task
  validation, and describes the feature-slice outcome and acceptance evidence.
- The initial project passes baseline existing-behavior checks but fails the
  new feature predicate before the builder runs; `preRunExpectations` include
  the expected missing-feature failure.
- Final predicates require the task to move to `done/`, the verifier command
  to pass, `feature-slice-result.json` to contain the required feature and
  regression evidence, and the implementation to preserve adjacent behaviors.
- The fixture includes at least one calibration or regression check showing a
  shortcut candidate fails, then the shortcut is reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the feature-slice predicates passing and any objective metric visible in the
  run artifact and aggregate output.

## Source / Intent

Explorer run `2026-07-07T20-43-29-587Z-explorer-w69sa0` reviewed an empty
dispatchable queue. The ready task was blocked by a pending merge claim, the
OpenRouter rollout backlog task was dependency-blocked, and the surfaced
strategic blocked alternatives still require operator-captured evidence rather
than a new builder slice:

- `task-extend-harness-parity-and-eval-harness-with-model-`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2602.10975` ("FeatureBench: Benchmarking Agentic
  Coding for Complex Feature Development", submitted February 11, 2026 and
  accepted by ICLR 2026) describes feature-oriented coding tasks with
  execution-based evaluation. Its abstract emphasizes deriving feature-level
  tasks by tracing unit tests through dependency graphs, spanning multiple
  commits and PRs, preserving other features after separation, and reporting
  that Claude 4.5 Opus succeeds on only 11.0% of these tasks despite a 74.4%
  SWE-bench resolved rate.

Local overlap check:

- `builder-product-requirements-canary` covers preserving rich requirements
  through product changes, not adding a coherent feature slice across existing
  modules with adjacent regression proof.
- `builder-multi-service-integration` covers service wiring and startup, not
  feature-level behavior implemented across a dependency-linked code path.
- `builder-targeted-test-writing` covers authoring useful tests, not using
  feature/regression tests as the core implementation evidence.
- `builder-multi-point-wiring` covers multi-location wiring, not a
  product-feature slice with executable feature and regression artifacts.

## Initiative

Outcome-grade autonomy evaluation.

## Product / Safety Link

Product: strengthens KOTA's evidence that builders can complete real feature
development, not only localized fixes or specialized canaries, while preserving
existing behavior through executable artifacts.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and any deterministic scoring
  scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  feature-slice predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `feature-slice-result.json`, regression evidence, and any objective metric
  values.
- Evidence of a temporary shortcut/regression causing the fixture to fail,
  with the regression reverted before staging.
