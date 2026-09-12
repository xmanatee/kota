---
status: blocked
priority: p2
---
# Add a scientific-claim reproduction fixture to the eval harness

## Current Contract

Build/identify the current-source image and image-local KOTA executable, configure
the existing provider-egress/auth owners, and execute the supported isolated eval.
These are setup and validation work, not an operator-capture prerequisite. Preserve
verifier isolation, shortcut rejection, claim/holdout results and live provenance;
calibration is not a nested-agent pass. Block only if a specific unavailable
credential or execution authority prevents further useful work, naming the exact
requirement without exposing secrets or inferring absence from an old denial.

This contract supersedes historical blocking and operational-capture requirements.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Attributable runtime evidence that this task can invoke authenticated contained evaluation with image/setup discovery and restricted provider egress.

The existing evidence-review kind above records an execution-authority
precondition, not a request for manual capture or a completed eval. Its path is
only a discovery hint: automatically collected, task-linked capability exports
from any scoped location are acceptable. Reopen as soon as they establish a
permitted invocation; image setup and the live nested-builder pass remain this
task's work. A report's existence or the mediation task's completion alone does
not establish that authority.

## Execution assessment (2026-09-12 resumption and repair)

This native invocation lacks a permitted runtime action for the authenticated,
contained evaluation. On resumption and again during repair, `/usr/local/bin/docker version --format
'{{.Server.Version}}'` failed with permission denied at `/var/run/docker.sock`.
This establishes a restriction of this worker, not missing host Docker or login.
The available native authorization service only returns task-writer authorization;
the eval module exposes CLI/client/HTTP execution but no callable native eval tool
in this invocation. No current-source image or provider-egress setup could be
identified through that restricted execution path.

Resume when the runtime exposes an authorized contained-eval invocation with
image/setup discovery, adapter-owned authentication and restricted provider
egress to this run. The existing
`task-enable-runtime-mediated-contained-evaluation` owns that mediation work.
It is a potential remedy rather than a hard predecessor: an equivalent authorized
runtime invocation also satisfies this prerequisite, so no `depends_on` is required.
No additional owner consent or manually captured result is required. Preserve
the same fixture, isolated verifier and run lineage, then perform the live
nested-builder evaluation and inspect both claim artifacts, predicate results,
objective metric and execution provenance before completion.

Run `2026-09-12T06-41-29-357Z-builder-zdcy03` revalidated fixture discovery and
11 scientific-claim owner tests against source
`8e5cb18a046ab3f55c35605b55eb97ddd1689b60`. These cover scorer acceptance,
hardcoded/prewritten shortcut rejection, malformed provenance and analyzer
boundary behavior. Process doubles in owner tests do not prove live Docker
containment or model execution. No source changes were needed; no live pass is
claimed. Transcripts and the execution-boundary assessment are retained under
this run's agent artifact directory, summarized in `execution-readiness.md`.


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
- Final predicates verify the task reached archived `status: done`, the analysis command
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
- Do not mark the task done from fixture-load evidence alone. The authorized isolated
  execution described below must complete the live nested-agent pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-scientific-claim-reproduction/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/`, is valid under task
  validation, and describes the scientific-claim reproduction outcome and
  acceptance evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include the expected failures.
- Final predicates require the task to reach archived `status: done`, the reconstruction
  command to pass, `claim-result.json` to contain the correct verdict and
  deterministic metric, and the candidate to avoid hardcoded/prose-only
  shortcuts.
- The fixture includes at least one regression check showing a shortcut
  candidate fails, then the shortcut is reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the claim-evidence predicates passing and any objective metric visible in the
  run artifact and aggregate output.

## Execution Readiness

The historical bare eval command below is not the current execution recipe.
Use the existing eval runner for builder-scientific-claim-reproduction with its required container isolation,
an explicitly identified image and image-local KOTA executable, provider-egress
policy, and runtime-authorized authentication. The CLI owns these options; do
not paste invented image names or relax executable-verifier isolation to use the
host default. The fixture's local/deterministic requirement applies to its data
and analysis, not to removal of the runner's security boundary.

The owner has authorized Docker-based validation. Use that authority only through
an available permitted execution path. A denial limits that context; continue
useful supported setup and collect results automatically when authorized,
without requiring a person to type the command. Keep credentials private and
verify live outcome and provenance, not just readiness or a nonempty transcript.

## Status (2026-05-27 builder)

The fixture files, minimal initial project, scorer, objective metric, and
shortcut-regression unit test have been implemented. Local validation passed
for fixture loading, the focused fixture test, and TypeScript.

The required live eval was attempted from run
`.kota/runs/2026-05-27T08-15-53-541Z-builder-ad3yfx/eval-run-transcript.txt`.
It reached the nested builder agent step, then failed because the nested Codex
harness could not reach `https://api.openai.com/v1/responses` in this
environment. No `claim-result.json` was produced, so that attempt did not
satisfy the live-evidence requirement.

## Source / Intent

Explorer run `2026-05-27T08-10-22-693Z-explorer-zfupdd` created this task after
reviewing a zero-actionable queue.

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

## Status (2026-06-15 blocked audit)

The fixture is present and listed by `pnpm kota eval list`, but the required
`.kota/runs/scientific-claim-reproduction-live-pass/` capture is still absent.
The latest local artifacts for this fixture stop before a complete
`eval-set-report.json`, so there is no pass artifact to promote from.

## Status (2026-07-25 live-probe blocker)

The provenance-pinned Runtime Probe reached a trusted host but stopped before
the nested builder because Codex authentication was unavailable to the probe.
A direct builder-sandbox retry also stopped before the nested agent because the
sandbox rejects the loopback listener required by the builder runtime. Neither
attempt produced `claim-result.json`, predicate results, or an objective metric,
so neither attempt supplied a passing live result.

## Status (2026-07-25 scorer hardening)

The trusted scientific-claim predicate now reruns both declared analysis
commands and one verifier-only data shape from a permission-restricted
temporary directory. Focused regressions prove that prewriting both expected
artifacts while retaining the wrong starter analyzer fails, hardcoding answers
for both visible data sets fails on verifier-only data, and candidate code
cannot read host files. The scorer resolves the temporary directory to its
canonical path before granting each analyzer process access only to its copied
module and current CSV input. This keeps relative analyzer reads working when
the host temp path is a symlink such as `/tmp` while preserving host-file
denial.

The post-repair direct eval produced
`.kota/runs/2026-07-24T21-20-40-008Z-builder-83nst2/verifier-calibration.json`
with `passed: true`: golden and accepted-alternative cases pass, null and
adversarial cases fail as expected, and the objective-metric comparison passes.
A regression and direct eval using the symlinked `/tmp` path now pass the same
calibration before execution reaches nested builder execution
step and stops at the sandbox's loopback-listener preflight. The remaining
product criterion is authenticated, isolated live eval evidence, not a prescribed
operator capture.

## Historical disposition (2026-09-10)

Production fixture loading succeeds. Docker 29.3.1 and host Codex login are ready; historical authentication/loopback denials describe older execution contexts, not the current host. The remaining prerequisite is the isolated candidate setup described below. Use the existing eval owner: pnpm kota eval run --fixture builder-scientific-claim-reproduction --repeats 1 with current container/egress options. Retain claim-result.json, claim-holdout-result.json, predicate details and objective metric, live builder provenance and eval-set-report.json. Use the artifact path returned by the runner (.kota/eval-runs/<stamp>), linked to the parent run. No human-only capture or exact directory prefix is required. The Docker engine has about 7.65 GiB RAM; do not reuse a historical 128-GiB profile. Existing calibration passes are partial evidence, not a live builder pass.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T10:23:57.524Z -->
