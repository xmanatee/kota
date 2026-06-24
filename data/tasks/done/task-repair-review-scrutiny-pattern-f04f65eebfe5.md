---
id: task-repair-review-scrutiny-pattern-f04f65eebfe5
title: Repair recurring thin critic acceptances
status: done
priority: p2
area: autonomy
task_class: Meta
summary: Make critic reviews for builder modules/Platform carry inspectable evidence instead of recurring thin acceptances.
created_at: 2026-06-23T22:39:46.012Z
updated_at: 2026-06-24T00:22:35.000Z
---

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:critic:builder:modules:Platform`
Evidence fingerprint: `d01ae854c7f1a802ae14938c67ba1c1887e8c99d0ad2f40daacb808d69b8ef7a`

## Review-Scrutiny Evidence

- Reviewer surface: critic
- Workflow/context: builder modules/Platform
- Thin acceptances: 9/10 (0.90)
- Decisions: pass
- Run ids: 2026-06-20T01-43-46-079Z-builder-sn760p, 2026-06-20T16-13-29-856Z-builder-9yi39d, 2026-06-20T18-42-46-982Z-builder-laibg5, 2026-06-20T23-44-03-227Z-builder-67alz5, 2026-06-21T00-47-06-643Z-builder-tcwbba, 2026-06-21T01-15-36-093Z-builder-i89vvj, 2026-06-21T02-12-34-863Z-builder-g7wed9, 2026-06-21T04-01-08-375Z-builder-gwz8i6, 2026-06-22T03-02-11-073Z-builder-qb0sve
- Task ids: task-add-a2a-push-notification-configuration-support, task-add-accepted-alternative-verifier-calibration-to-e, task-add-ranked-repository-exploration-scenario-to-harn, task-add-spec-conditioned-protocol-compliance-fixture, task-expand-accepted-alternative-calibration-across-bro, task-refactor-operator-ui-builders, task-refactor-workflow-graph-explain, task-refactor-workflow-simulation-engine, task-report-per-component-eval-attribution-for-score-mo
- Window: 2026-06-20T01:54:58.897Z to 2026-06-22T04:39:41.848Z
- Active reason: critic produced 9/10 thin approval-like decisions for builder modules/Platform.

- 2026-06-20T01-43-46-079Z-builder-sn760p critic pass task-refactor-workflow-simulation-engine .kota/runs/2026-06-20T01-43-46-079Z-builder-sn760p/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=247; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T16-13-29-856Z-builder-9yi39d critic pass task-refactor-workflow-graph-explain .kota/runs/2026-06-20T16-13-29-856Z-builder-9yi39d/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=289; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T18-42-46-982Z-builder-laibg5 critic pass task-refactor-operator-ui-builders .kota/runs/2026-06-20T18-42-46-982Z-builder-laibg5/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=266; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T23-44-03-227Z-builder-67alz5 critic pass task-report-per-component-eval-attribution-for-score-mo .kota/runs/2026-06-20T23-44-03-227Z-builder-67alz5/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=171; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T00-47-06-643Z-builder-tcwbba critic pass task-add-accepted-alternative-verifier-calibration-to-e .kota/runs/2026-06-21T00-47-06-643Z-builder-tcwbba/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=192; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T01-15-36-093Z-builder-i89vvj critic pass task-expand-accepted-alternative-calibration-across-bro .kota/runs/2026-06-21T01-15-36-093Z-builder-i89vvj/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=246; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T02-12-34-863Z-builder-g7wed9 critic pass task-add-ranked-repository-exploration-scenario-to-harn .kota/runs/2026-06-21T02-12-34-863Z-builder-g7wed9/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=198; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T04-01-08-375Z-builder-gwz8i6 critic pass task-add-spec-conditioned-protocol-compliance-fixture .kota/runs/2026-06-21T04-01-08-375Z-builder-gwz8i6/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=230; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T03-02-11-073Z-builder-qb0sve critic pass task-add-a2a-push-notification-configuration-support .kota/runs/2026-06-22T03-02-11-073Z-builder-qb0sve/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=152; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

## Desired Outcome

Repair the reviewer prompt, artifact writer, metric extraction, or review
workflow so accepted work leaves enough inspectable evidence for later
critics and operators without blocking every concise valid approval.

## Constraints

- Build on existing review-scrutiny artifacts and report aggregation.
- Do not add another reviewer, hidden reasoning trace, or audit store.
- Do not create one task per thin acceptance; keep this repair anchored to
  the stable pattern fingerprint above.
- Treat absent metrics and unsupported legacy artifacts as context, not
  standalone proof of poor review.
- Keep cost fields out of autonomy-facing outputs.

## Product / Safety Link

This Meta repair supports the Product claim that KOTA's autonomous work can
be trusted from run artifacts, and the Safety concern that agent-authored
code should not be silently accepted as reviewer workload or habituation
rises.

## Done When

- Fresh review-scrutiny windows no longer trigger this pattern fingerprint,
  or the detector thresholds/fingerprints are deliberately adjusted with
  focused tests and evidence.
- The repaired reviewer path records concrete warnings, findings, cited
  files, evidence ids, follow-up tasks, or another supported scrutiny
  signal when accepting comparable work.
- Operator-facing report or attention output still names future recurring
  thin-acceptance patterns and repair task ids without cost fields.

## Source / Intent

Auto-created by `review-scrutiny-escalator` from recent review-scrutiny
artifacts. Repeated thin approvals should become one evidence-backed repair
task instead of remaining only in the operator report.

## Initiative

Outcome-aware autonomy governance.

## Acceptance Evidence

- Focused test output for the repaired reviewer/artifact path.
- Detector or report fixture showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Operator-facing report or attention fixture showing future escalations
  include the repair task id without cost fields.

## Outcome

Accepted critic verdicts that omit warnings, critical issues, and file-line
citations now persist as `pass_with_warnings` with an explicit reviewer
evidence warning, so the review-scrutiny artifact records a supported signal
without blocking the run. The review-scrutiny escalator fixture covers fresh
builder `modules`/`Platform` artifacts with that warning and confirms they no
longer create a recurring thin-acceptance repair task, while the existing
attention fixture still names future repair task ids without cost fields.

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:critic:builder:modules:Platform -->
<!-- review-scrutiny-evidence-fingerprint: d01ae854c7f1a802ae14938c67ba1c1887e8c99d0ad2f40daacb808d69b8ef7a -->
