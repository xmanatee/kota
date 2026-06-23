---
id: task-repair-review-scrutiny-pattern-c16eb63e9c89
title: Repair recurring thin critic acceptances
status: done
priority: p2
area: autonomy
task_class: Meta
summary: Make critic reviews for builder autonomy/Unclassified carry inspectable evidence instead of recurring thin acceptances.
created_at: 2026-06-23T22:39:45.975Z
updated_at: 2026-06-23T23:16:11.000Z
---

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:critic:builder:autonomy:Unclassified`
Evidence fingerprint: `d4d72bf743c9409f70e78d9dc49dc1b69becc40d424ceed3d2fe0aaec1971c00`

## Review-Scrutiny Evidence

- Reviewer surface: critic
- Workflow/context: builder autonomy/Unclassified
- Thin acceptances: 21/21 (1.00)
- Decisions: pass
- Run ids: 2026-06-16T23-00-21-494Z-builder-k9wmol, 2026-06-17T09-33-15-552Z-builder-7nznt4, 2026-06-18T12-07-51-539Z-builder-8o0dai, 2026-06-18T12-21-26-420Z-builder-11pptd, 2026-06-18T12-33-02-781Z-builder-k7rfn5, 2026-06-18T15-35-51-930Z-builder-g8xnid, 2026-06-19T01-24-43-916Z-builder-gzmvtu, 2026-06-19T02-00-12-100Z-builder-cq861g, 2026-06-19T07-32-53-546Z-builder-kuhf75, 2026-06-19T13-42-02-507Z-builder-uopl44, 2026-06-20T00-43-06-892Z-builder-zgkac8, 2026-06-20T01-21-19-939Z-builder-m051lb, 2026-06-20T15-38-22-326Z-builder-dhtc5l, 2026-06-20T17-20-08-793Z-builder-2mz48v, 2026-06-20T19-10-07-038Z-builder-ymv8z6, 2026-06-20T22-09-36-575Z-builder-yyw7bj, 2026-06-22T09-05-05-207Z-builder-idhqcb, 2026-06-22T13-06-19-844Z-builder-yxlxtf, 2026-06-22T14-33-33-428Z-builder-kpya7t, 2026-06-22T15-09-20-973Z-builder-rdfzns, 2026-06-22T22-39-39-419Z-builder-wn49m0
- Task ids: task-add-daemon-wide-global-progress-review-trigger, task-clear-current-progress-reviewer-collect-evidence-d, task-clear-current-progress-reviewer-evidence-id-dead-l, task-clear-malformed-trajectory-diagnostics-dead-letter, task-clear-post-fix-progress-reviewer-evidence-id-dead-, task-clear-progress-reviewer-hidden-evidence-dlq, task-close-post-fix-autonomy-health-reviewer-dead-lette, task-prevent-autonomy-workflows-from-committing-pre-exi, task-refactor-oversized-builder-and-security-review-wor, task-resolve-2026-06-20-progress-reviewer-evidence-id-d, task-resolve-current-progress-reviewer-evidence-id-dlq, task-resolve-open-health-reviewer-and-security-review-d, task-resolve-open-progress-reviewer-write-scope-dead-le, task-resolve-recurring-progress-reviewer-evidence-id-dl, task-resolve-security-review-index-lock-dead-letter, task-resolve-security-review-investigate-candidates-tim, task-resolve-stale-builder-and-inbox-sorter-dlqs, task-split-oversized-security-review-workflow-test, task-stabilize-live-progress-reviewer-review-evidence-f, task-stabilize-progress-reviewer-review-evidence-dead-l, task-throttle-no-action-scope-improver-file-change-runs
- Window: 2026-06-17T00:09:03.879Z to 2026-06-22T22:48:41.267Z
- Active reason: critic produced 21/21 thin approval-like decisions for builder autonomy/Unclassified.

- 2026-06-16T23-00-21-494Z-builder-k9wmol critic pass task-stabilize-progress-reviewer-review-evidence-dead-l .kota/runs/2026-06-16T23-00-21-494Z-builder-k9wmol/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=175; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-17T09-33-15-552Z-builder-7nznt4 critic pass task-prevent-autonomy-workflows-from-committing-pre-exi .kota/runs/2026-06-17T09-33-15-552Z-builder-7nznt4/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=192; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T12-07-51-539Z-builder-8o0dai critic pass task-stabilize-live-progress-reviewer-review-evidence-f .kota/runs/2026-06-18T12-07-51-539Z-builder-8o0dai/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=214; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T12-21-26-420Z-builder-11pptd critic pass task-resolve-security-review-investigate-candidates-tim .kota/runs/2026-06-18T12-21-26-420Z-builder-11pptd/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=229; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T12-33-02-781Z-builder-k7rfn5 critic pass task-resolve-stale-builder-and-inbox-sorter-dlqs .kota/runs/2026-06-18T12-33-02-781Z-builder-k7rfn5/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=174; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T15-35-51-930Z-builder-g8xnid critic pass task-clear-progress-reviewer-hidden-evidence-dlq .kota/runs/2026-06-18T15-35-51-930Z-builder-g8xnid/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=209; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T01-24-43-916Z-builder-gzmvtu critic pass task-resolve-open-health-reviewer-and-security-review-d .kota/runs/2026-06-19T01-24-43-916Z-builder-gzmvtu/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=233; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T02-00-12-100Z-builder-cq861g critic pass task-add-daemon-wide-global-progress-review-trigger .kota/runs/2026-06-19T02-00-12-100Z-builder-cq861g/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=312; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T07-32-53-546Z-builder-kuhf75 critic pass task-throttle-no-action-scope-improver-file-change-runs .kota/runs/2026-06-19T07-32-53-546Z-builder-kuhf75/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=276; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T13-42-02-507Z-builder-uopl44 critic pass task-resolve-current-progress-reviewer-evidence-id-dlq .kota/runs/2026-06-19T13-42-02-507Z-builder-uopl44/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=211; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T00-43-06-892Z-builder-zgkac8 critic pass task-resolve-security-review-index-lock-dead-letter .kota/runs/2026-06-20T00-43-06-892Z-builder-zgkac8/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=209; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T01-21-19-939Z-builder-m051lb critic pass task-refactor-oversized-builder-and-security-review-wor .kota/runs/2026-06-20T01-21-19-939Z-builder-m051lb/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=185; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T15-38-22-326Z-builder-dhtc5l critic pass task-resolve-open-progress-reviewer-write-scope-dead-le .kota/runs/2026-06-20T15-38-22-326Z-builder-dhtc5l/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=158; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T17-20-08-793Z-builder-2mz48v critic pass task-split-oversized-security-review-workflow-test .kota/runs/2026-06-20T17-20-08-793Z-builder-2mz48v/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=205; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T19-10-07-038Z-builder-ymv8z6 critic pass task-resolve-2026-06-20-progress-reviewer-evidence-id-d .kota/runs/2026-06-20T19-10-07-038Z-builder-ymv8z6/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=200; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T22-09-36-575Z-builder-yyw7bj critic pass task-resolve-recurring-progress-reviewer-evidence-id-dl .kota/runs/2026-06-20T22-09-36-575Z-builder-yyw7bj/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=235; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T09-05-05-207Z-builder-idhqcb critic pass task-clear-current-progress-reviewer-collect-evidence-d .kota/runs/2026-06-22T09-05-05-207Z-builder-idhqcb/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=235; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T13-06-19-844Z-builder-yxlxtf critic pass task-clear-current-progress-reviewer-evidence-id-dead-l .kota/runs/2026-06-22T13-06-19-844Z-builder-yxlxtf/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=173; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T14-33-33-428Z-builder-kpya7t critic pass task-clear-malformed-trajectory-diagnostics-dead-letter .kota/runs/2026-06-22T14-33-33-428Z-builder-kpya7t/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=197; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T15-09-20-973Z-builder-rdfzns critic pass task-clear-post-fix-progress-reviewer-evidence-id-dead- .kota/runs/2026-06-22T15-09-20-973Z-builder-rdfzns/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=222; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T22-39-39-419Z-builder-wn49m0 critic pass task-close-post-fix-autonomy-health-reviewer-dead-lette .kota/runs/2026-06-22T22-39-39-419Z-builder-wn49m0/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=183; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

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

## Result

Builder critic reviews now count concrete file-line citations as a supported
review-scrutiny signal, and the critic prompt requires accepted reviews to cite
reviewed file/line evidence when reviewable repo files changed. Focused tests
cover artifact writing, aggregation, escalation suppression, and operator report
rendering.

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:critic:builder:autonomy:Unclassified -->
<!-- review-scrutiny-evidence-fingerprint: d4d72bf743c9409f70e78d9dc49dc1b69becc40d424ceed3d2fe0aaec1971c00 -->
