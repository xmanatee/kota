---
id: task-repair-review-scrutiny-pattern-fc896caa1a7a
title: Repair recurring thin critic acceptances
status: done
priority: p2
area: autonomy
task_class: Meta
summary: Make critic reviews for builder core/Unclassified carry inspectable evidence instead of recurring thin acceptances.
created_at: 2026-06-23T22:39:46.024Z
updated_at: 2026-06-24T00:37:26.000Z
---

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:critic:builder:core:Unclassified`
Evidence fingerprint: `1d5c29afab5923dcb6ce11c5d90cd4a5a15c71fa8e6e806fa3dca65981e5d9d4`

## Review-Scrutiny Evidence

- Reviewer surface: critic
- Workflow/context: builder core/Unclassified
- Thin acceptances: 8/8 (1.00)
- Decisions: pass
- Run ids: 2026-06-20T17-45-13-223Z-builder-1z5el8, 2026-06-22T15-35-14-278Z-builder-izxjpn, 2026-06-22T17-46-38-843Z-builder-ysyis2, 2026-06-22T18-44-41-698Z-builder-75g8xf, 2026-06-22T18-58-36-187Z-builder-56a3rx, 2026-06-22T21-13-02-310Z-builder-2sormt, 2026-06-22T23-13-57-475Z-builder-os279u, 2026-06-23T19-10-14-966Z-builder-sqr09y
- Task ids: task-fingerprint-remote-mcp-tool-declarations-across-re, task-handle-recent-core-tool-source-size-warnings, task-split-oversized-agent-harness-guard-implementation, task-split-oversized-agent-harness-guard-test-surfaces, task-split-oversized-core-workflow-executor-and-dispatc, task-split-oversized-core-workflow-run-store-helpers-af, task-split-oversized-event-journal-source-surface, task-split-oversized-mcp-manager-and-tool-provenance-fi
- Window: 2026-06-20T18:02:49.320Z to 2026-06-23T19:26:41.540Z
- Active reason: critic produced 8/8 thin approval-like decisions for builder core/Unclassified.

- 2026-06-20T17-45-13-223Z-builder-1z5el8 critic pass task-split-oversized-core-workflow-run-store-helpers-af .kota/runs/2026-06-20T17-45-13-223Z-builder-1z5el8/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=246; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T15-35-14-278Z-builder-izxjpn critic pass task-fingerprint-remote-mcp-tool-declarations-across-re .kota/runs/2026-06-22T15-35-14-278Z-builder-izxjpn/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=130; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T17-46-38-843Z-builder-ysyis2 critic pass task-split-oversized-agent-harness-guard-test-surfaces .kota/runs/2026-06-22T17-46-38-843Z-builder-ysyis2/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=191; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T18-44-41-698Z-builder-75g8xf critic pass task-split-oversized-agent-harness-guard-implementation .kota/runs/2026-06-22T18-44-41-698Z-builder-75g8xf/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=180; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T18-58-36-187Z-builder-56a3rx critic pass task-split-oversized-core-workflow-executor-and-dispatc .kota/runs/2026-06-22T18-58-36-187Z-builder-56a3rx/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=174; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T21-13-02-310Z-builder-2sormt critic pass task-split-oversized-event-journal-source-surface .kota/runs/2026-06-22T21-13-02-310Z-builder-2sormt/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=193; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T23-13-57-475Z-builder-os279u critic pass task-split-oversized-mcp-manager-and-tool-provenance-fi .kota/runs/2026-06-22T23-13-57-475Z-builder-os279u/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=255; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T19-10-14-966Z-builder-sqr09y critic pass task-handle-recent-core-tool-source-size-warnings .kota/runs/2026-06-23T19-10-14-966Z-builder-sqr09y/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=209; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

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

## Completion Notes

- Added `src/modules/autonomy/review-scrutiny-core-pattern.test.ts` covering the
  exact `review-scrutiny:critic:builder:core:Unclassified` fingerprint.
- Fresh warning-backed builder core acceptances now have focused regression
  coverage showing they do not cross the escalation gate.
- The same fixture proves future core thin-acceptance escalations still surface
  repair task ids in operator report/attention output without cost fields.
- Focused validation passed:
  `pnpm exec vitest run src/modules/autonomy/review-scrutiny-core-pattern.test.ts src/modules/autonomy/critic-verdict.test.ts src/modules/autonomy/review-scrutiny-escalation.test.ts`.

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:critic:builder:core:Unclassified -->
<!-- review-scrutiny-evidence-fingerprint: 1d5c29afab5923dcb6ce11c5d90cd4a5a15c71fa8e6e806fa3dca65981e5d9d4 -->
