---
id: task-add-a-scientific-claim-reproduction-fixture-to-the
title: Add a scientific-claim reproduction fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder reconstructs a small underspecified computational workflow from a paper-like claim, executes deterministic evidence, and records whether the claim is supported or refuted.
created_at: 2026-05-27T08:12:34.216Z
updated_at: 2026-05-27T08:12:34.216Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
multi-point wiring, full-cycle bare-repo setup, black-box behavior
reconstruction, empirical-code optimization, and replayed workflow substrate.
They still do not exercise a related autonomy failure mode: reconstructing an
underspecified computational procedure from a paper-like claim, executing the
workflow, and deciding whether the resulting evidence supports or refutes that
claim.

AutoMat is a current primary-source signal for this gap. It evaluates coding
agents on recovering underspecified computational procedures, navigating
specialized toolchains, and interpreting whether generated evidence supports a
scientific claim. The KOTA-relevant lesson is not to import a materials-science
benchmark or add a domain-specific toolchain. It is to add one compact local
fixture where claim reproduction is artifact-graded instead of accepted from
the builder's final prose.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small
paper-like excerpt, local data, and a normalized task. The builder must
reconstruct a bounded computational workflow, run it, and write an explicit
claim-evidence artifact such as `claim-result.json` containing:

- the reproduced numeric evidence;
- the verdict (`supported` or `refuted`);
- the command or script used to compute the evidence; and
- enough provenance for the scorer to verify the result came from the local
  data and workflow, not from a hardcoded answer.

The fixture should make the scientific-reproduction failure mode observable:

- The initial tree includes a deliberately incomplete or underspecified
  analysis script plus local fixture data.
- The claim is small and deterministic, with at least one tempting shortcut or
  wrong preprocessing choice that would produce the wrong verdict.
- Final predicates verify the task moved to `done/`, the analysis command
  passes, the evidence artifact has the correct verdict and metric, and the
  implementation is not a prose-only or hardcoded answer.
- Any objective metric, such as reproduced effect size or error delta, is
  reported through the existing objective-metric path while pass/fail remains
  predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add an AutoMat importer, scientific
  benchmark runner, LLM judge, or second fixture setup DSL.
- Keep the scenario tiny, deterministic, and local. It must run without network
  access, external services, Docker images, GPUs, large dependencies, or
  platform-specific scientific software.
- Use a paper-like task, not a real materials-science dependency stack. A small
  CSV/JSON dataset and a local script are enough if they force the builder to
  reconstruct procedure details and interpret evidence.
- The scorer must reject obvious shortcuts, including hardcoding the expected
  verdict, ignoring holdout/filtered rows, or writing a plausible explanation
  without executing the analysis.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.
- If the implementation environment cannot make a live agent call, do not mark
  the task done from fixture-load evidence alone. Reposition it honestly with a
  typed operator-capture precondition for the live pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the scientific-claim reproduction outcome and
  acceptance evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include the expected failures.
- Final predicates require the task to move to `done/`, the reconstruction
  command to pass, `claim-result.json` to contain the correct verdict and
  deterministic metric, and the candidate to avoid hardcoded/prose-only
  shortcuts.
- The fixture includes at least one regression check showing a shortcut
  candidate fails, then the shortcut is reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the claim-evidence predicates passing and any objective metric visible in the
  run artifact and aggregate output.

## Source / Intent

Explorer run `2026-05-27T08-10-22-693Z-explorer-zfupdd` reviewed a zero
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://arxiv.org/abs/2605.00803` ("Can Coding Agents Reproduce Findings in
  Computational Materials Science?", submitted May 1, 2026) introduces AutoMat,
  a benchmark for coding agents reproducing scientific claims from
  computational materials-science papers. The abstract highlights three
  relevant challenges: recovering underspecified procedures, executing
  specialized workflows, and deciding whether evidence supports a claim. It
  reports that agents fail especially when workflows must be reconstructed from
  paper text alone, with incomplete procedures, methodological deviations, and
  execution fragility as recurring errors.

Local overlap check:

- `builder-empirical-code-optimization` covers improving code against a
  deterministic numeric objective, not deciding whether reconstructed evidence
  supports a claim.
- `builder-black-box-behavior-reconstruction` covers source-hidden executable
  behavior, not paper-like procedure reconstruction or claim interpretation.
- `builder-bare-repo-full-cycle` covers environment setup and verification-test
  generation, not scientific evidence interpretation.

The nonduplicative gap is a compact claim-reproduction fixture that grades
procedure reconstruction plus evidence interpretation through artifacts.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders can turn
underspecified external claims into reproducible local evidence and an honest
support/refute decision, without importing a benchmark suite or trusting
agent prose.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and any deterministic scoring
  scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  claim-evidence predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `claim-result.json`, and any objective metric values.
- Evidence of a temporary shortcut/regression causing the fixture to fail,
  with the regression reverted before staging.
