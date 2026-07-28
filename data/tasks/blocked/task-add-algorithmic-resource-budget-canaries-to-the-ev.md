---
id: task-add-algorithmic-resource-budget-canaries-to-the-ev
title: Add algorithmic resource-budget canaries to the eval harness
status: blocked
priority: p2
area: modules
task_class: Meta
summary: Seed a compact builder fixture where a naive solution passes small examples but fails deterministic large-input time or memory canaries, making scalable design and resource management artifact-graded.
created_at: 2026-06-22T23:35:15.496Z
updated_at: 2026-07-28T01:26:03.000Z
---

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
- Final predicates require the task to move to `done/`, the verifier to pass,
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
- Do not mark the task done from fixture-load evidence alone. The trusted host
  Runtime Probe below must complete the live nested-agent pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-algorithmic-resource-budget-canary/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the resource-budget canary outcome and acceptance
  evidence.
- The initial project passes visible examples but fails the final predicates
  before the builder runs; `preRunExpectations` include expected failures for
  the large canaries or budget artifact.
- Final predicates require the task to move to `done/`, the verifier command
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

## Runtime Probe

command: pnpm kota eval run --fixture builder-algorithmic-resource-budget-canary --repeats 1 --keep
timeoutMs: 14400000

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/algorithmic-resource-budget-live-pass/
description: Linux trusted-host Runtime Probe evidence — operator runs pnpm kota eval run --fixture builder-algorithmic-resource-budget-canary --repeats 1 --keep on a Linux host where Bubblewrap and prlimit are installed, /proc/sys/kernel/core_pattern is readable and non-piped, and the Codex login is active; capture a passing transcript, eval-set-report.json, predicate details, resource-budget-result.json, generated input sizes, comparison-budget values, and max_comparison_budget_ratio under .kota/runs/algorithmic-resource-budget-live-pass/
```

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
