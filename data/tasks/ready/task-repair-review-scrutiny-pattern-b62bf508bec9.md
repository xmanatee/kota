---
id: task-repair-review-scrutiny-pattern-b62bf508bec9
title: Repair recurring thin semantic-gate acceptances
status: ready
priority: p2
area: autonomy
task_class: Meta
summary: Make semantic-gate reviews for improver (unknown)/Unclassified carry inspectable evidence instead of recurring thin acceptances.
created_at: 2026-06-23T22:39:45.988Z
updated_at: 2026-06-23T22:39:45.988Z
---

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:semantic-gate:improver:(unknown):Unclassified`
Evidence fingerprint: `5cb743d47dc99fbde4144f00d032998eeeda9f43651409ba1c495a58c6bd48a8`

## Review-Scrutiny Evidence

- Reviewer surface: semantic-gate
- Workflow/context: improver (unknown)/Unclassified
- Thin acceptances: 14/16 (0.88)
- Decisions: pass
- Run ids: 2026-06-18T15-11-23-440Z-improver-31ugug, 2026-06-19T00-24-18-481Z-improver-scmkyg, 2026-06-19T07-32-56-094Z-improver-r5w7b2, 2026-06-19T13-42-03-918Z-improver-xy6hyp, 2026-06-20T15-28-10-451Z-improver-j7qlz9, 2026-06-20T18-11-56-465Z-improver-kcl3vw, 2026-06-20T22-00-11-660Z-improver-o4vdq5, 2026-06-21T05-27-13-407Z-improver-7fhx9i, 2026-06-22T00-29-10-927Z-improver-sn7jua, 2026-06-22T08-09-33-519Z-improver-a55x2r, 2026-06-22T09-20-00-438Z-improver-5yo7sd, 2026-06-22T13-28-20-894Z-improver-ms0mmt, 2026-06-22T13-36-43-740Z-improver-0z2mau, 2026-06-23T20-46-22-075Z-improver-6wh9i9
- Task ids: (none)
- Window: 2026-06-18T15:32:34.010Z to 2026-06-23T22:07:03.810Z
- Active reason: semantic-gate produced 14/16 thin approval-like decisions for improver (unknown)/Unclassified.

- 2026-06-18T15-11-23-440Z-improver-31ugug semantic-gate pass (no task) .kota/runs/2026-06-18T15-11-23-440Z-improver-31ugug/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=185; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T00-24-18-481Z-improver-scmkyg semantic-gate pass (no task) .kota/runs/2026-06-19T00-24-18-481Z-improver-scmkyg/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=141; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T07-32-56-094Z-improver-r5w7b2 semantic-gate pass (no task) .kota/runs/2026-06-19T07-32-56-094Z-improver-r5w7b2/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=141; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T13-42-03-918Z-improver-xy6hyp semantic-gate pass (no task) .kota/runs/2026-06-19T13-42-03-918Z-improver-xy6hyp/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=115; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T15-28-10-451Z-improver-j7qlz9 semantic-gate pass (no task) .kota/runs/2026-06-20T15-28-10-451Z-improver-j7qlz9/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=126; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T18-11-56-465Z-improver-kcl3vw semantic-gate pass (no task) .kota/runs/2026-06-20T18-11-56-465Z-improver-kcl3vw/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=195; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T22-00-11-660Z-improver-o4vdq5 semantic-gate pass (no task) .kota/runs/2026-06-20T22-00-11-660Z-improver-o4vdq5/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=131; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T05-27-13-407Z-improver-7fhx9i semantic-gate pass (no task) .kota/runs/2026-06-21T05-27-13-407Z-improver-7fhx9i/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=170; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T00-29-10-927Z-improver-sn7jua semantic-gate pass (no task) .kota/runs/2026-06-22T00-29-10-927Z-improver-sn7jua/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=149; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T08-09-33-519Z-improver-a55x2r semantic-gate pass (no task) .kota/runs/2026-06-22T08-09-33-519Z-improver-a55x2r/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=229; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T09-20-00-438Z-improver-5yo7sd semantic-gate pass (no task) .kota/runs/2026-06-22T09-20-00-438Z-improver-5yo7sd/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=203; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T13-28-20-894Z-improver-ms0mmt semantic-gate pass (no task) .kota/runs/2026-06-22T13-28-20-894Z-improver-ms0mmt/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=183; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T13-36-43-740Z-improver-0z2mau semantic-gate pass (no task) .kota/runs/2026-06-22T13-36-43-740Z-improver-0z2mau/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=190; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T20-46-22-075Z-improver-6wh9i9 semantic-gate pass (no task) .kota/runs/2026-06-23T20-46-22-075Z-improver-6wh9i9/semantic-gate-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=204; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

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

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:semantic-gate:improver:(unknown):Unclassified -->
<!-- review-scrutiny-evidence-fingerprint: 5cb743d47dc99fbde4144f00d032998eeeda9f43651409ba1c495a58c6bd48a8 -->
