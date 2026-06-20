---
id: task-report-per-component-eval-attribution-for-score-mo
title: Report per-component eval attribution for score movement
status: ready
priority: p2
area: modules
task_class: Platform
summary: Derive a typed eval-harness attribution report from existing run-configuration, fixture, trajectory, and verifier evidence so score changes identify which component changed instead of stopping at an opaque end-to-end delta.
created_at: 2026-06-20T23:40:59.483Z
updated_at: 2026-06-20T23:40:59.483Z
---

## Problem

KOTA's eval harness now protects regression baselines from several misleading
comparisons: resource-profile drift, repeat-count mismatch, configuration
fingerprint mismatch, verifier calibration failures, and trajectory-quality
warnings are all recorded as typed evidence. That prevents an invalid
comparison from being treated as a clean model-quality signal.

The remaining operator gap is attribution. When an eval-set score moves, the
report can say that the population is comparable or not comparable, but it
does not summarize which component changed or which evidence explains the
movement. Operators still have to inspect `eval-set-report.json`, child run
metadata, fixture diagnostics, verifier calibration, trajectory diagnostics,
objective metrics, and resource profiles by hand to distinguish "the model got
worse" from "the harness changed", "the fixture changed", "context retrieval
missed the target", "the environment drifted", or "the feedback/verifier path
changed".

This is especially risky now that KOTA runs multiple presets, harnesses,
fixture modes, replay-backed autonomy fixtures, and richer scoring artifacts.
The end-to-end score is useful, but it is too coarse to guide iteration when
several agent-system components can move the outcome by similar margins.

## Desired Outcome

Eval-set reports include a typed per-component attribution section derived
from existing artifacts. The section should not claim causal proof; it should
make the observable component evidence explicit and bounded.

At minimum, the report identifies and summarizes these components:

- model and preset: active preset id, resolved harness/model/tier evidence, and
  whether the model population changed versus the compared baseline;
- harness adapter and execution path: agent harness id, replay/live execution
  mode, container or host execution backend, and any adapter-level unsupported
  or degraded state;
- prompt, skill, and context inputs: selected skills, prompt-resolution or
  skill-ablation evidence where present, and context-retrieval diagnostics when
  the run supplies them;
- fixture and verifier: fixture ids/spec hash, fixture mode, verifier
  calibration status, predicate changes, objective metrics, and code-health or
  trajectory diagnostic warnings;
- environment and resources: resource profile, execution preflight, timeout
  envelope, provider-egress policy, and other gate-eligibility facts already
  recorded by the harness; and
- feedback loop: visible tests, hidden predicates, checker commands, repair
  loops, or other feedback channels surfaced through existing run artifacts.

For comparable eval populations, the report should show per-component
stability plus per-fixture outcome deltas and diagnostic deltas. For
non-comparable populations, it should name the changed components that caused
or accompanied the non-gating comparison reason so the operator can decide
whether to rerun, accept a fresh baseline, or open a follow-up task.

## Constraints

- Keep the implementation inside `src/modules/eval-harness/` unless a narrow
  existing artifact type needs an owning-module read. Do not add a parallel
  benchmark runner, scoring database, metrics store, or external paper import.
- Reuse the existing run-configuration fingerprint, baseline assessment,
  fixture specs, fixture-run artifacts, verifier calibration, objective
  metrics, resource profiles, code-health diagnostics, trajectory diagnostics,
  and harness-parity context diagnostics where they are already available.
- The attribution report is evidence classification, not causal inference.
  Phrase fields and summaries as "changed", "stable", "missing",
  "unsupported", "diagnostic delta", and "candidate explanation"; do not rank
  model providers or claim a component caused a score delta without a
  deterministic local comparison.
- Keep records bounded and sanitized. Do not copy raw prompts, raw tool
  outputs, secrets, full traces, cost figures, or large diffs into the
  attribution summary.
- Preserve existing pass/fail scoring, pass@k/pass^k, resource gating,
  configuration drift handling, baseline persistence, and cadence behavior.
  This task adds operator evidence; it must not weaken gate strictness.
- Keep cost and model-choice optimization out of agent-facing prompts and
  autonomy context.

## Done When

- `eval-set-report.json` contains a typed component-attribution section with a
  stable schema, a compact operator summary, and machine-readable component
  entries for model/preset, harness, prompt/skill/context, fixture/verifier,
  environment/resource, and feedback-loop evidence.
- Baseline assessment attaches component-attribution summaries to comparable
  and non-comparable outcomes, including a `changedComponents` or equivalent
  list when configuration drift makes the comparison non-gating.
- Per-fixture summaries identify outcome deltas and diagnostic deltas without
  requiring the operator to open every child run directory.
- CLI and HTTP eval-run output surface the compact attribution summary and
  artifact path through existing eval-harness result shapes; no new command is
  required.
- Focused tests cover comparable unchanged runs, preset/model drift, fixture
  manifest drift, verifier-calibration change, resource-profile drift,
  missing child run metadata, and a trajectory/context diagnostic delta.
- Existing eval-harness scoring and baseline tests remain green.

## Source / Intent

Explorer run `2026-06-20T23-09-00-759Z-explorer-vlrd4f` reviewed a zero
actionable queue (`ready=0`, `doing=0`, `backlog=0`). The strategic blocked
alternatives surfaced by `inspect-queue` all still require operator-captured
artifacts and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.17799` ("Position: Coding Benchmarks Are
  Misaligned with Agentic Software Engineering", submitted June 16, 2026)
  argues that coding-agent benchmark scores collapse model, harness, context,
  environment, and feedback signals into one end-to-end score; that each
  component can move scores by margins comparable to model-generation
  differences; and that the lack of component-level signal makes iteration
  difficult.

Local overlap check:

- `task-record-eval-harness-run-configuration-fingerprints` already prevents
  unlike eval populations from being compared as normal quality signal, but it
  does not explain score movement beyond a configuration fingerprint summary.
- `task-add-eval-harness-verifier-calibration-probes` proves rich scorers
  reject null/golden/adversarial cases, but it does not summarize verifier or
  feedback-channel changes across eval-set comparisons.
- `task-write-trajectory-quality-diagnostics-for-workflow-` and
  `task-add-context-retrieval-effectiveness-diagnostics-to` add local process
  diagnostics, but the eval-set report does not aggregate those diagnostics
  into a component-level attribution view.
- `task-add-a-skill-injection-ablation-fixture-to-the-eval` measures one
  explicit prompt/skill component through a fixture mode; it is not a general
  attribution report for normal cadence score movement.

The nonduplicative gap is a first-party attribution artifact that lets
operators inspect which recorded agent-system components changed when an eval
score changes, without importing an external benchmark or treating
attribution as model-ranking science.

## Initiative

Autonomy eval harness measurement integrity: KOTA should make eval score
movement explainable through typed local evidence so operators can improve the
right component instead of trusting or dismissing an opaque end-to-end score.

## Acceptance Evidence

- Focused test transcript, for example:
  `pnpm test src/modules/eval-harness/eval-set.test.ts src/modules/eval-harness/baseline-assessment.test.ts src/modules/eval-harness/cli.test.ts`.
- A sample `eval-set-report.json` under `.kota/runs/<run-id>/` or
  `.kota/eval-runs/<run-id>/` showing the component-attribution section for a
  comparable run and a non-comparable drift case.
- CLI or HTTP output excerpt showing the compact attribution summary and the
  artifact path.
