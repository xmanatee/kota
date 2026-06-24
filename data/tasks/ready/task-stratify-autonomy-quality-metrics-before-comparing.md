---
id: task-stratify-autonomy-quality-metrics-before-comparing
title: Stratify autonomy quality metrics before comparing agent outcomes
status: ready
priority: p2
area: autonomy
task_class: Safety
summary: Add deterministic stratification to autonomy quality reports so pooled review, code-health, and follow-up metrics are grouped by workflow, harness, task shape, and changed area before operators compare outcome trends.
created_at: 2026-06-24T06:35:19.545Z
updated_at: 2026-06-24T06:35:19.545Z
---

## Problem

KOTA now reports several outcome-quality signals for autonomous work:
review-scrutiny metrics, code-health drift, post-completion corrective
follow-ups, trajectory diagnostics, and control-monitor coverage. Those reports
are useful, but the operator can still be misled by pooled counts when the mix
of work changes. A window with more p3 cleanup, a different agent harness, a
different workflow, or a different module area can make aggregate approval,
thin-acceptance, warning, or corrective-follow-up rates look better or worse
without reflecting a real change in autonomy quality.

That matters because these reports are used to steer the autonomous queue. If
composition shifts are invisible, KOTA can overreact to an aggregate trend or
miss a real regression isolated to one workflow, harness, task class, or module
area.

## Desired Outcome

Extend the operator-facing autonomy quality report so its existing quality
metrics are stratified before operators compare outcome trends.

At minimum, the report and JSON output should group recent quality signals by
available deterministic dimensions such as:

- workflow name and reviewer surface;
- resolved agent harness or preset when the run artifact exposes it;
- task priority, `task_class`, and task area;
- warning or follow-up reason family; and
- changed top-level source area or module when the existing artifact already
  exposes touched paths.

Keep the existing aggregate totals, but add compact context that names the most
important composition shifts, slice-level rates, and sample-size warnings. The
operator should be able to tell whether a pooled trend is broad, isolated to one
slice, or likely explained by a changed mix of task/harness/workflow inputs.

## Constraints

- Build on existing autonomy report readers and run/task artifacts. Do not add
  a second report command, external dataset, GitHub miner, benchmark import, or
  LLM judge.
- Use only deterministic fields already present in task files, run metadata,
  review-scrutiny records, code-health-drift records, control-monitor records,
  and post-completion follow-up records. If a dimension is missing, report it
  as missing rather than inferring it from free-form prose.
- Keep records bounded and sanitized. Do not copy prompts, raw tool payloads,
  approval inputs, credentials, full diffs, or cost fields into the new
  stratification output.
- Avoid statistical overclaiming. Small sample counts should be flagged as weak
  evidence, and the report should not imply causality from a slice difference.
- Do not duplicate eval-harness confounder/resource-profile work. This task is
  about KOTA's own autonomy operator report over real workflow runs.

## Done When

- The autonomy report aggregation normalizes quality records into a small
  stratification model with dimensions, sample counts, numerator/denominator
  rates, missing-dimension counts, and run/task references for the largest
  contributing slices.
- `pnpm kota report` and JSON-mode output include a concise quality
  stratification section that keeps aggregate totals visible but names
  slice-level context and composition shifts for at least review-scrutiny,
  code-health-drift, and post-completion follow-up signals.
- Focused tests cover:
  - a pooled quality trend that looks worse while per-workflow or per-harness
    slices are stable or reversed;
  - an isolated slice regression that should stay visible even when the pooled
    aggregate is flat;
  - missing harness/task metadata counted explicitly instead of inferred;
  - small-sample slices marked as weak evidence; and
  - sanitized output that omits prompts, raw tool payloads, diffs, costs, and
    credentials.
- `pnpm kota report --json` or an equivalent fixture report artifact shows the
  new stratification output against representative local run fixtures.
- `pnpm run validate-tasks` passes.

## Source / Intent

Explorer run `2026-06-24T05-59-39-311Z-explorer-jhud5l` saw a
strategic-ready coverage gap: the ready queue had only p3 tasks, no backlog,
and all surfaced strategic blocked alternatives still required
operator-captured evidence. Those blocked tasks could not honestly be promoted.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` operator-captured live
  eval artifact.
- `task-add-algorithmic-resource-budget-canaries-to-the-ev` still requires the
  `.kota/runs/algorithmic-resource-budget-canary-live-pass/` operator-captured
  live eval artifact.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` operator-
  captured live eval artifact.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires the
  all-registered-harness `.kota/runs/harness-parity-*` capture.

External sources checked:

- `https://arxiv.org/abs/2604.09409` ("Do AI Coding Agents Log Like Humans? An
  Empirical Study", submitted April 10, 2026) was the never-seen watchlist
  entry for this run, but its local signal is already covered by completed
  `task-add-agent-authored-logging-obligation-diagnostics`, so no duplicate
  logging task was opened.
- `https://arxiv.org/abs/2606.22711` ("Beyond Simpson's Paradox: A Cascade of
  Confounders in AI Agent Pull-Request Co-Authorship", submitted June 21,
  2026) reports that pooled AI-agent PR co-authorship outcomes reverse or
  disappear after stratifying by agent identity, repository, and PR structure.
  KOTA should not import the AIDev dataset or mine GitHub. The local signal is
  narrower: KOTA's own autonomy quality reports should make composition and
  slice-level rates visible before operators compare aggregate outcome trends.

Local overlap check:

- `task-record-autonomy-review-scrutiny-metrics` counts approval-like and thin
  acceptance decisions across reviewer surfaces, but it does not explain
  whether a trend is broad or concentrated in one workflow, harness, task
  class, or area.
- `task-report-autonomy-authored-code-health-drift-in-oper` reports repeated
  source-size/code-health surfaces and cleanup coverage, but it does not
  stratify quality rates across task/harness/workflow composition changes.
- `task-classify-ci-and-integration-failures-in-post-compl` adds a
  post-completion follow-up reason, but it does not protect operators from
  pooled-rate confounding.
- Existing eval-harness resource-profile and pass@k/pass^k guidance covers
  benchmark configuration confounders, not KOTA's own operator report over
  live autonomous workflow outcomes.

## Initiative

Outcome-aware autonomy governance.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be steered from durable operator reports, and the Safety concern that
pooled quality metrics should not hide slice-specific regressions or create a
false sense of improvement.

## Acceptance Evidence

- Diff showing the stratification data model, aggregation, report rendering,
  JSON output, and focused tests.
- Test transcript for the report aggregation/rendering cases covering
  aggregate-vs-slice reversal, isolated slice regression, missing metadata,
  small samples, and sanitized output.
- Report output artifact under `.kota/runs/<run-id>/` showing the new
  stratification section with slice counts, rates, composition notes, and
  run/task refs.
- Validation transcript for `pnpm run validate-tasks`.
