---
status: done
---

# Report autonomy-authored code-health drift in operator summaries

## Problem

KOTA now records several completion-quality signals for autonomous work:
review-scrutiny metrics, control-monitor coverage, trajectory diagnostics,
post-completion corrective follow-ups, and builder source-size warnings. Those
signals catch important local failures, but maintainability drift is still
mostly visible as scattered p3 cleanup tasks after the fact.

The current ready queue shows the shape clearly: both actionable tasks are
source-size cleanup fallout from successful autonomy/report work. The operator
can inspect each cleanup task, but there is no compact report answer to:

- how often accepted autonomous builder runs left source-size or code-health
  warnings;
- which modules or files repeatedly absorb the drift;
- whether warnings are covered by active cleanup tasks or typed cleanup
  exceptions; and
- whether the trend is improving or getting worse across the recent report
  window.

Without that aggregate view, KOTA can keep accepting locally green patches
while source size and structural complexity grow until progress-reviewer emits
one narrow cleanup at a time.

## Desired Outcome

Extend the operator-facing autonomy report with a deterministic
code-health-drift summary for recent autonomous builder runs.

At minimum, the summary should derive from existing artifacts and task files to
show:

- total recent builder runs inspected and how many included source-size or
  code-health warnings;
- counts by warning family, module or top-level area, and repeated file path;
- active cleanup coverage for each repeated warning surface, including whether
  an open task or typed source-size cleanup exception already addresses it;
- recent run refs, task ids, and commit refs for the most important examples;
  and
- compact trend buckets for the current report window versus the prior
  comparable window.

The report should be useful even if the first implementation only consumes
source-size review artifacts and builder run summaries. If broader lightweight
code-health measurements are added, keep them bounded and deterministic.

## Constraints

- Build on existing autonomy report aggregation and builder/source-size
  artifacts. Do not add a second report command, external benchmark, LLM judge,
  hidden-history miner, or metrics database.
- Do not duplicate `task-record-post-completion-corrective-follow-up-metric`.
  That task links completed work to later corrective tasks; this task reports
  completion-time maintainability drift and whether follow-up coverage exists.
- Do not duplicate eval-harness code-health diagnostics. Eval fixtures inspect
  candidate workspaces; this task summarizes KOTA's own autonomous builder runs
  from run artifacts and task metadata.
- Treat typed source-size cleanup work as coverage, not as a new failure.
  Cleanup runs that reduce a cited warning should not make the drift trend look
  worse unless they introduce new unrelated warnings.
- Keep records bounded and sanitized. Do not copy raw prompts, full diffs,
  large transcripts, secrets, or cost fields into the report.
- This is an operator diagnostic, not a new blocker on accepted runs. Existing
  source-size repair-loop gates and progress-reviewer follow-ups remain the
  enforcement path.

## Done When

- The autonomy report reader normalizes recent builder run summaries and
  source-size review artifacts into code-health-drift records with run id,
  task id, commit ref when available, changed source files, warning family,
  outcome, and cleanup coverage.
- `pnpm kota report` and JSON-mode output include a compact code-health-drift
  section with counts, repeated surfaces, trend buckets, and refs to active
  cleanup tasks or typed cleanup exceptions.
- Focused tests cover:
  - a clean builder run with no warnings;
  - a builder run with a source-size advisory linked to an open cleanup task;
  - repeated warnings on the same file across multiple runs;
  - a source-size cleanup run that reduces the cited warning without
    worsening the trend; and
  - malformed or old run artifacts counted as unsupported rather than crashing
    the report.
- The report omits cost fields, raw prompt/tool content, and full diffs.
- `pnpm run validate-tasks` passes.

## Product / Safety Link

This Safety task supports the Product claim that KOTA's autonomous development
loop can be trusted from durable evidence, and the Safety concern that accepted
agent-authored changes should not quietly accumulate maintainability debt
until cleanup tasks become the dominant ready queue.

## Source / Intent

Explorer run `2026-06-24T02-31-29-425Z-explorer-pgwxe9` saw a strategic-ready
coverage gap: the ready queue had only p3 source-size cleanup tasks, no
backlog, and all surfaced strategic p2 blocked alternatives still required
operator-captured evidence.

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

External source checked:

- `https://arxiv.org/abs/2601.13597` ("AI IDEs or Autonomous Agents? Measuring
  the Impact of Coding Agents on Software Development", submitted January 20,
  2026 and revised January 27, 2026) reports persistent quality risks after
  autonomous-agent adoption, including higher static-analysis warnings and
  cognitive complexity, and calls for quality safeguards plus provenance
  tracking. KOTA should not import the AIDev dataset or mine GitHub; the local
  response is an operator report over KOTA's own run artifacts.

Local overlap check:

- `task-record-post-completion-corrective-follow-up-metric` links completed
  tasks to later corrective follow-ups, including source-size follow-ups, but
  it does not aggregate completion-time maintainability drift across accepted
  builder runs.
- `task-add-code-health-diagnostics-to-persistent-multi-ro` adds code-health
  diagnostics inside eval-harness fixture workspaces, not KOTA's own autonomy
  report over real builder runs.
- Existing source-size repair-loop checks and progress-reviewer tasks create
  individual warnings and cleanups. They do not summarize repeated warning
  surfaces, cleanup coverage, or trend direction for operators.

## Initiative

Outcome-aware autonomy governance.

## Acceptance Evidence

- Diff showing the code-health-drift reader, report aggregation, report
  rendering, and JSON output wiring.
- Focused tests for clean, warning, repeated-warning, cleanup-coverage,
  cleanup-reduction, and unsupported-artifact cases.
- `pnpm kota report` or JSON-mode output captured under `.kota/runs/<run-id>/`
  showing code-health-drift counts, repeated surfaces, active cleanup coverage,
  and no cost fields.
- Validation transcript for `pnpm run validate-tasks`.
- Completed in builder run `2026-06-24T02-48-46-763Z-builder-fx0xgo`.
  Acceptance artifacts:
  `.kota/runs/2026-06-24T02-48-46-763Z-builder-fx0xgo/kota-report.json`,
  `.kota/runs/2026-06-24T02-48-46-763Z-builder-fx0xgo/success-criteria.txt`,
  and `.kota/runs/2026-06-24T02-48-46-763Z-builder-fx0xgo/success-criteria-verified.txt`.
