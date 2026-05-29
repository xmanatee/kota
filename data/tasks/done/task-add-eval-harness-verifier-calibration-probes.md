---
id: task-add-eval-harness-verifier-calibration-probes
title: Add eval-harness verifier calibration probes
status: done
priority: p2
area: modules
summary: Require fixtures with custom or shell-backed scoring to prove their verifier against null, golden, and adversarial calibration cases before their outcomes can enter eval-harness aggregate scoring.
created_at: 2026-05-29T09:14:10.598Z
updated_at: 2026-05-29T09:28:07.843Z
---

## Problem

KOTA's eval harness now enforces fixture provenance and pre-run expectations,
so fixtures cannot be undocumented or already satisfied before a workflow runs.
That still leaves a scoring-integrity gap: the harness trusts each final
predicate, shell verifier, custom scorer, and objective metric definition once
the fixture reaches the final state.

For simple file predicates this is fine, but richer fixtures increasingly rely
on executable or fixture-specific scoring logic. A broken command, skipped
script target, weak scorer, or overly-permissive custom predicate can turn a
bad run into a pass. Pre-run expectations catch only the starting state; they
do not prove the verifier can distinguish empty, correct, and shortcut-shaped
outputs.

Sourcegraph's CodeScaleBench makes this failure class concrete. Its public
benchmark material describes large and multi-repo coding tasks, dual-verifier
suites, run snapshots with traces and scores, and a QA process focused on task
integrity, scoring anomalies, and verifier failures. Its launch write-up also
calls out real QA findings such as broken verifiers, instruction
contamination, silent scoring failures, and accidentally ineffective checks.
KOTA should not import CodeScaleBench, Harbor, or its scoring pipeline; the
local gap is a first-party verifier-calibration path for KOTA fixtures that
already use executable or custom scoring.

## Desired Outcome

Eval-harness fixture specs can declare verifier calibration probes for
nontrivial scoring paths. Before a fixture's outcome can enter aggregate
scoring, the harness proves the verifier against fixture-owned cases:

- `null` — an empty or no-op output must fail the fixture's scoring path;
- `golden` — a known-good fixture state or artifact must pass;
- `adversarial` — a shortcut-shaped output, keyword dump, partial artifact, or
  otherwise plausible false positive must fail.

The calibration result is a typed fixture configuration signal, not a model
capability result. Failed calibration aborts the fixture attempt before the
workflow executor runs and records a clear artifact explaining which case
passed or failed unexpectedly.

## Constraints

- Keep the work inside `src/modules/eval-harness/` unless a narrow existing
  test fixture needs metadata. Do not add a parallel benchmark runner, metrics
  store, or external CodeScaleBench/Harbor integration.
- Reuse the existing fixture loader, predicate evaluator, objective metric
  evaluator, and runner artifact path. Do not add a second ad hoc scoring DSL.
- Require calibration only where it matters: executable, custom, or
  fixture-specific scoring paths such as `shell-succeeds`, `shell-fails`,
  `lx12-scientific-claim-result`, objective metric thresholds, or future
  nontrivial predicates. Basic structural predicates such as `file-exists` and
  `file-contains` should not need boilerplate calibration cases.
- Calibration cases must be fixture-owned files or deterministic fixture
  transformations. They must not invoke the LLM, depend on network access, or
  mutate the canonical `initial/` tree.
- Treat missing or malformed required calibration as a fixture configuration
  error. Do not silently downgrade it to a warning or exclude the fixture from
  aggregates without a typed reason.
- Preserve existing provenance, pre-run expectations, resource profiles,
  replay recordings, objective metrics, and pass@k/pass^k semantics.

## Done When

- Fixture loading validates a typed `verifierCalibration` contract for scoring
  paths that require calibration and rejects malformed or missing required
  cases with fixture-specific errors.
- `runFixture` evaluates calibration probes before workflow execution and
  writes a `verifier-calibration.json` artifact for every calibrated fixture.
- Calibration failure is represented as a fixture configuration outcome, not as
  pass/fail/timeout model behavior, and aggregate scoring does not count it as
  capability evidence.
- At least one existing rich fixture, preferably a shell- or custom-scored
  fixture such as scientific-claim reproduction, empirical optimization, or
  black-box behavior reconstruction, declares null/golden/adversarial cases so
  the path is exercised against real fixture code.
- Focused tests cover loader rejection, successful calibration, null false
  positive, golden false negative, adversarial false positive, and aggregate
  handling for calibration configuration failures.
- `src/modules/eval-harness/AGENTS.md` is updated only if the durable fixture
  contract changes; keep detailed case mechanics in code and tests.

## Source / Intent

Explorer run `2026-05-29T09-12-14-018Z-explorer-i4zncm` reviewed an empty
actionable queue. Both backlog tasks are dependency-blocked on
`task-enable-autonomous-access-to-auth-walled-sources-so`, and the strategic
blocked alternatives surfaced by `inspect-queue` all require operator capture
and are not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://github.com/sourcegraph/CodeScaleBench` describes a benchmark suite
  for evaluating coding agents on large, enterprise-scale and multi-repo
  developer tasks, with versioned suites, auditable snapshots, per-task traces,
  score/cost/retrieval summaries, dual-verifier suites, and QA scripts for
  task integrity and scoring anomalies.
- `https://sourcegraph.com/blog/codescalebench-testing-coding-agents-on-large-codebases-and-multi-repo-software-engineering-tasks`
  describes CodeScaleBench QA failures including broken verifiers, instruction
  contamination, silent scoring failures, and accidentally ineffective
  verification checks.

Local overlap check:

- `task-add-pre-run-predicate-sanity-checks-to-eval-harnes` already made
  fixtures prove final predicates are not satisfied in the initial state.
- `task-validate-eval-harness-fixture-provenance-in-the-lo` already enforces
  why a fixture exists.
- `task-report-per-fixture-signal-to-noise-diagnostics-in-` already reports
  repeated-run instability after valid fixture runs.
- `task-add-context-retrieval-effectiveness-diagnostics-to` already covers
  CodeScaleBench's retrieval-target diagnostic signal in harness-parity.
- No open or completed task found a first-party calibration path that proves a
  fixture verifier rejects null and shortcut-shaped outputs while accepting a
  known-good state before its score enters aggregates.

## Initiative

Autonomy eval harness measurement integrity: KOTA's pass@k/pass^k evidence
should depend on calibrated, non-vacuous verifiers, not only on well-intended
fixture prose or post-run aggregate diagnostics.

## Acceptance Evidence

- Focused test transcript, for example:
  `pnpm test src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts src/modules/eval-harness/scoring.test.ts`.
- A run artifact under `.kota/runs/<run-id>/` or `.kota/eval-runs/<run-id>/`
  containing `verifier-calibration.json` with passing null/golden/adversarial
  cases for a real calibrated fixture.
- A deliberately broken calibration fixture or unit fixture demonstrates that
  a null or adversarial false positive aborts before workflow execution and is
  excluded from capability scoring with a typed configuration reason.
