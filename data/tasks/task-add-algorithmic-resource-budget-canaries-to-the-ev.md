---
status: blocked
priority: p2
depends_on: [task-enable-runtime-mediated-contained-evaluation, task-complete-contained-evaluation-host-setup]
---
# Add algorithmic resource-budget canaries to the eval harness

## Current Contract

Prepare the current-source isolated image, image-local executable and supported
provider-egress/auth route, then run the canary through the existing eval owner.
No human capture is required. Preserve deterministic budgets, shortcut rejection,
candidate containment and actual nested-agent result provenance. A missing image
or unconfigured proxy is setup work; only a specific unavailable credential or
execution authority warrants an external block after useful work is exhausted.
Do not report a calibration or readiness pass as a live-builder result.

This contract supersedes historical blocking and operational-capture requirements.

## Implementation Prerequisite

Both implementation dependencies are archived as done. Their scoped native tool
and deployment recipe are available; the host-setup completion explicitly leaves
service activation and live measurements to host follow-up and these benchmarks.
The native worker cannot call the host Docker socket. Use the scoped tool once
the trusted host activates its grant. Do not require a separate readiness artifact
to admit the task, or treat dependency completion as a successful benchmark.
The fixture/scorer already has focused local coverage; the live nested-agent
result remains to be obtained and inspected by this task.


## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
black-box behavior reconstruction, scientific-claim reproduction, unfamiliar
language strategy construction, product canaries, multi-service integration,
and empirical score improvement. They still do not directly grade a common
coding-agent failure mode: a builder writes code that passes small examples
and ordinary unit tests, but uses an algorithm or data structure that fails
under larger deterministic input because of time or memory growth.

That gap matters because the operator-visible product claim is not just
"agent can patch a function"; it is "KOTA can be trusted to complete real
development work through artifact-backed evidence." A small-example pass can
hide a design that exhausts CPU, memory, or submission budget once the input
shape scales.

ProjDevBench is a current primary-source signal for this. It evaluates coding
agents on end-to-end project development and reports that agents often handle
basic functionality while struggling with time-complexity optimization and
resource management. Its project repo also exposes OJ-style verdicts such as
TLE, MLE, runtime error, wrong answer, and memory leak. KOTA should not import
ProjDevBench, an online judge, or an LLM code-review rubric. The local
response is one compact fixture where scalable design is checked by
deterministic canaries and artifacts.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a tiny
project with a naive implementation that passes visible examples but fails
larger deterministic resource-budget cases.

The fixture should make scalable-design failure observable:

- The initial tree includes a deliberately simple implementation with
  acceptable behavior on small examples and unacceptable growth on generated
  large cases.
- The task asks for a resource-aware implementation, not a cosmetic
  optimization or a hardcoded answer.
- The verifier runs small examples plus large synthetic canaries and writes a
  structured artifact such as `resource-budget-result.json` containing input
  sizes, observed pass/fail per canary, the verification command, and a
  deterministic operation-count or memory-growth proxy.
- Final predicates require the task to reach archived `status: done`, the verifier to pass,
  the evidence artifact to contain the expected canary results, and the
  implementation to avoid sample-only or hardcoded shortcuts.
- Any numeric value, such as operation count, max generated input size, or
  memory-growth proxy, is reported through the existing objective-metric path
  while pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, subprocess execution,
  resource-profile, and objective-metric paths. Do not add a ProjDevBench
  importer, online-judge integration, Docker-only runner, LLM reviewer, or
  second fixture DSL.
- Keep the scenario tiny, deterministic, and local. It must run without
  network access, external services, large dependencies, GPUs, or platform-
  specific tooling.
- Avoid brittle wall-clock-only scoring. A wall-clock timeout can be a final
  guard, but the primary pass/fail signal should come from deterministic
  generated cases and an auditable operation-count or memory-growth proxy.
- The fixture must require an algorithmic or data-structure improvement. A
  candidate that only changes constants, raises a timeout, skips large cases,
  or special-cases visible examples should fail.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.
- Do not mark the task done from fixture-load evidence alone. The authorized isolated
  execution described below must complete the live nested-agent pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-algorithmic-resource-budget-canary/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/`, is valid under task
  validation, and describes the resource-budget canary outcome and acceptance
  evidence.
- The initial project passes visible examples but fails the final predicates
  before the builder runs; `preRunExpectations` include expected failures for
  the large canaries or budget artifact.
- Final predicates require the task to reach archived `status: done`, the verifier command
  to pass, `resource-budget-result.json` to contain the required canary
  fields, and the deterministic budget proxy to stay under the configured
  threshold.
- The scorer rejects obvious shortcuts, including hardcoded expected answers,
  skipped large cases, editing the verifier to relax thresholds, or writing a
  plausible artifact without running the generated cases.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the resource-budget predicates passing and any objective metric visible in
  the run artifact and aggregate output.
- The fixture includes at least one regression check showing a sample-only or
  threshold-relaxing shortcut fails, then the shortcut is reverted before
  staging.

## Execution Readiness

The historical bare eval command below is not the current execution recipe.
Use the existing eval runner for builder-algorithmic-resource-budget-canary with its required container isolation,
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

## Status (2026-07-28 builder)

The committed fixture remains deterministically calibrated: visible examples
pass; the quadratic, sample-only, comparison-proxy bypass, and call-order
hardcoded-answer candidates fail the source-keyed 4,096-item canaries; a
present case-metadata import shortcut fails the specific module-import source
audit; and the golden merge-sort candidate passes all three canaries with
resourceBudgetScore 1 and maxOperationRatio 0.550362. The candidate source
digest is recorded and deterministically seeds the canary permutations, so
editing a candidate to embed observed answers changes the inputs and expected
answers on the next run.

The current workflow host is Darwin. KOTA intentionally records Runtime
Probes as not-executed on non-Linux hosts because they cannot provide the PID
namespace and teardown boundary required to contain detached descendants.
Therefore this run cannot produce the required trusted live nested-agent pass,
and fixture-load or calibration evidence is not used to claim completion.

## Status (2026-06-23 builder)

The fixture files, minimal initial project, generated-canary verifier,
objective metric, verifier calibration, and sample-only shortcut self-test
have been implemented. Local validation passed for the fixture's visible
examples, expected initial large-canary failure, golden calibration candidate,
adversarial shortcut candidate, shortcut self-test, and `pnpm kota eval list`.

The required live eval was attempted from run
`.kota/runs/2026-06-22T23-44-16-981Z-builder-4945oa/eval-run-transcript.txt`.
It reached the nested builder agent step, then failed because the required
Codex harness was not logged in (`localAuth missing: Codex ChatGPT login not
active; run codex login`). No live builder-produced
`resource-budget-result.json` was produced, so that attempt did not satisfy the
live-evidence requirement.

## Status (2026-07-24 recovery)

The daemon host has an authenticated Codex harness. The live pass is now owned
by the provenance-pinned Runtime Probe above, so the earlier builder-sandbox
authentication limitation is no longer an operator precondition.

## Source / Intent

Explorer run `2026-06-22T23-00-20-991Z-explorer-whdo09` created this task after
reviewing an empty actionable queue.

External sources checked:

- `https://arxiv.org/abs/2602.01655` ("ProjDevBench: Benchmarking AI Coding
  Agents on End-to-End Project Development", submitted February 2, 2026 and
  revised February 9, 2026) describes a benchmark for building complete
  repositories from project requirements. Its abstract identifies system
  architecture, functional correctness, iterative refinement, and especially
  time-complexity optimization and resource management as hard points for
  coding agents.
- `https://github.com/zsworld6/projdevbench` is the project repository. Its
  README describes OJ-style execution feedback, resource-limit diagnostics,
  containerized reproducibility, and problem categories that include data
  structures, interpreters, storage systems, algorithms, and optimization.

Local overlap check:

- `builder-empirical-code-optimization` covers improving a numeric score, not
  proving a solution scales from examples to large deterministic canaries.
- `builder-product-requirements-canary` covers preserving rich product
  requirements through implementation and follow-up changes, not algorithmic
  resource growth.
- `builder-multi-service-integration` covers component wiring and startup, not
  input-size complexity.
- `builder-bare-repo-full-cycle` covers environment setup and test creation,
  not large-case budget behavior.
- Eval-harness resource profiles make run comparability auditable, but they do
  not themselves create a fixture that catches sample-passing,
  resource-exhausting code.

The nonduplicative gap is one compact resource-budget canary fixture that
grades scalable design through deterministic artifacts.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders can
produce code that remains correct and bounded beyond small examples, without
importing an external benchmark or trusting final prose.

## Product / Safety Link

This Meta task supports the Product claim that KOTA can handle real coding
work through pluggable harnesses and the Safety concern that agent-authored
code should not be accepted from toy-example success while hiding predictable
resource exhaustion.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, generated-canary verifier, and
  deterministic scoring or shortcut-regression scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  resource-budget predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `resource-budget-result.json`, generated input sizes, budget proxy values,
  and any objective metrics.
- Evidence of a temporary sample-only or threshold-relaxing shortcut causing
  the fixture to fail, with the shortcut reverted before staging.

## Historical disposition (2026-09-10)

Production fixture loading succeeds. Docker 29.3.1 and host Codex login are ready; historical authentication/loopback denials describe older execution contexts, not the current host. The remaining prerequisite is the isolated candidate setup described below. Use the existing eval owner: pnpm kota eval run --fixture builder-algorithmic-resource-budget-canary --repeats 1 with current container/egress options. Retain resource-budget-result.json, generated cases, shortcut rejection and budget metrics, live builder provenance and eval-set-report.json. Use the artifact path returned by the runner (.kota/eval-runs/<stamp>), linked to the parent run. No human-only capture or exact directory prefix is required. The Docker engine has about 7.65 GiB RAM; do not reuse a historical 128-GiB profile. Existing calibration passes are partial evidence, not a live builder pass.

## Host setup dependency

The historical 17:25 UTC attempt found the same missing grant as the scientific-claim
and model comparisons. The shared `task-complete-contained-evaluation-host-setup`
implementation has since completed; its completion does not establish host
activation. Do not repeat inspection without changed host-grant evidence or ask
for a human-captured artifact.
The implemented fixture and its calibration remain available; the actual live
result is still outstanding and belongs here after host activation.

The trusted host must grant a contained-evaluation profile for this scope and
`builder-algorithmic-resource-budget-canary`. In repair attempt 1 of builder
`2026-09-12T14-17-50-103Z-builder-z75940`, the production command
`pnpm kota eval contained '{"operation":"inspect"}'` reached the native tool
and returned `is_error: true`: `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted
host environment.` Invocation `ff30f36936c05d3c383e945af7ca5689`, tool use
`tool-e9bc7cfc0e634a9e7eb15125e0857d9d`, identifies that response. The exact
runtime response is retained as `contained-inspect-response.json` in this run's
agent artifacts.

This is a missing host execution grant, not an inferred Docker, image, proxy or
credential absence. The implementation dependency is complete and the native
transport works. The host-owned profile authorizes the canonical scope, fixture,
preset, repeats, resource limits, current-source image/image-local executable,
and restricted provider-egress. The supported request schema cannot configure
those grants or prepare host images; local environment edits cannot configure
the trusted service. No credential was requested or inspected, and no host
execution or confinement bypass was attempted.

Resume after the host lifecycle owner supplies that profile through the existing
trusted environment and makes it visible to a native invocation. Inspect the
actual grant, finish any image/egress setup through permitted host capabilities,
and run the authorized profile with this fixture and `repeatCount: 1`. Inspect
passing predicates, generated canary results, objective metrics, and real nested
builder provenance before marking done. This does not require human capture,
manual benchmark execution, a new implementation dependency, or a separate
readiness artifact. The builder must not restart its parent daemon.

Repair validation: `pnpm kota eval list` exits successfully and loads this
fixture without schema/provenance errors. The focused owner scorer test passes
(1 passed, 6 unrelated cases deselected), rejecting sample-only, comparison-proxy,
hardcoded-answer and case-metadata shortcuts. These are partial fixture proofs;
no live nested agent ran and no live resource-budget metric is claimed. Only
this task's blocked disposition changed; the fixture and execution owners remain
unchanged. The prior yield-only assessment is superseded by this observed
execution prerequisite.

## Blocked on

```
kind: operator-capture
path: .kota/runs/
description: Trusted-host activation of a scope-bound algorithmic canary evaluation profile, observable through native contained inspection; equivalent attributable host readiness permits resuming without manual captures.
```

The path is an evidence-discovery hint in the existing task vocabulary, not a
required capture destination. A native inspection returning the authorized
fixture profile is sufficient to resume execution.

The trusted host must activate a scope-bound contained-evaluation profile that
authorizes `builder-algorithmic-resource-budget-canary`, its current-source image
and image-local executable, restricted provider egress, and one live repeat.
In resumed builder `2026-09-12T19-11-42-673Z-builder-f4378r`, the production
`pnpm kota eval contained '{"operation":"inspect"}'` invocation returned
`is_error: true`: `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment.`
Tool use `tool-ebf449deb25668f74fad66969fd21243` identifies the current response,
retained verbatim as `contained-inspect-response.json` in this run's agent directory.
This is observed missing execution authority, not a conclusion about host Docker,
credentials, image availability or proxy readiness from sandbox restrictions.

Resume this task after the host lifecycle owner installs/activates the reviewed
grant using the existing service/setup owners and it is visible to a native
invocation. Then inspect the grant, resolve any permitted image/egress setup,
run one live repeat and inspect actual nested-builder provenance, predicates,
generated canaries and objective metrics. No human capture or manual benchmark
execution is required. This builder cannot configure host grants through the
request schema or restart its parent daemon.

Only this task's disposition and stale prerequisite wording changed. The existing
fixture, scorer and execution owners are intact. Current `pnpm kota eval list`
passes and loads the fixture; the focused owner scorer test passes (one passed,
six unrelated cases skipped), exercising known shortcut rejection in a disposable
tree. These establish fixture loading and scorer rejection, not model quality.
Logs are `eval-list.log` and `scorer-test.log` in this run's agent directory.
No live nested agent ran, and no live resource-budget result, aggregate metric,
containment pass or completed benchmark is claimed.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T20:04:50.473Z -->
