---
status: done
---

# Repair recurring thin critic acceptances

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:critic:builder:modules:Unclassified`
Evidence fingerprint: `1286183d0bc955ff0ee9513f27ebc44643fb6d6475d678ae872e02a3818acc17`

## Review-Scrutiny Evidence

- Reviewer surface: critic
- Workflow/context: builder modules/Unclassified
- Thin acceptances: 13/16 (0.81)
- Decisions: pass
- Run ids: 2026-06-19T02-56-38-451Z-builder-7e669l, 2026-06-19T09-04-36-524Z-builder-c5h6qp, 2026-06-20T17-06-36-197Z-builder-uaps62, 2026-06-20T19-48-31-915Z-builder-dbmjlj, 2026-06-21T01-34-51-102Z-builder-x1e0oa, 2026-06-21T02-31-42-840Z-builder-eh6nlx, 2026-06-21T04-29-15-144Z-builder-udp5uw, 2026-06-21T07-25-10-376Z-builder-htu4n5, 2026-06-22T01-35-30-662Z-builder-9bklnw, 2026-06-22T06-09-59-064Z-builder-0lzbuq, 2026-06-22T06-26-55-128Z-builder-jq2a1z, 2026-06-22T15-23-51-787Z-builder-migg5a, 2026-06-23T19-47-15-526Z-builder-et00ya
- Task ids: task-add-compiled-automation-graph-explain-api, task-add-event-automation-simulation-harness, task-clear-resolved-eval-harness-cadence-dead-letter, task-handle-token-budget-module-adapter-source-size-war, task-split-oversized-a2a-channel-route-test-surface, task-split-oversized-a2a-push-notification-config-test-, task-split-oversized-daemon-operator-ui-surface-files, task-split-oversized-eval-attribution-module-files, task-split-oversized-eval-harness-entrypoint-and-daemon, task-split-oversized-eval-harness-fixture-and-runner-fi, task-split-oversized-execution-process-test-surface, task-split-oversized-repo-tasks-routes-and-route-tests, task-split-oversized-workflow-graph-explain-helper-file
- Window: 2026-06-19T03:52:35.411Z to 2026-06-23T20:09:45.712Z
- Active reason: critic produced 13/16 thin approval-like decisions for builder modules/Unclassified.

- 2026-06-19T02-56-38-451Z-builder-7e669l critic pass task-add-compiled-automation-graph-explain-api .kota/runs/2026-06-19T02-56-38-451Z-builder-7e669l/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=192; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T09-04-36-524Z-builder-c5h6qp critic pass task-add-event-automation-simulation-harness .kota/runs/2026-06-19T09-04-36-524Z-builder-c5h6qp/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=186; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T17-06-36-197Z-builder-uaps62 critic pass task-split-oversized-workflow-graph-explain-helper-file .kota/runs/2026-06-20T17-06-36-197Z-builder-uaps62/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=190; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T19-48-31-915Z-builder-dbmjlj critic pass task-split-oversized-daemon-operator-ui-surface-files .kota/runs/2026-06-20T19-48-31-915Z-builder-dbmjlj/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=214; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T01-34-51-102Z-builder-x1e0oa critic pass task-split-oversized-eval-attribution-module-files .kota/runs/2026-06-21T01-34-51-102Z-builder-x1e0oa/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=263; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T02-31-42-840Z-builder-eh6nlx critic pass task-split-oversized-eval-harness-entrypoint-and-daemon .kota/runs/2026-06-21T02-31-42-840Z-builder-eh6nlx/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=268; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T04-29-15-144Z-builder-udp5uw critic pass task-split-oversized-eval-harness-fixture-and-runner-fi .kota/runs/2026-06-21T04-29-15-144Z-builder-udp5uw/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=173; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T07-25-10-376Z-builder-htu4n5 critic pass task-clear-resolved-eval-harness-cadence-dead-letter .kota/runs/2026-06-21T07-25-10-376Z-builder-htu4n5/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=156; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T01-35-30-662Z-builder-9bklnw critic pass task-split-oversized-repo-tasks-routes-and-route-tests .kota/runs/2026-06-22T01-35-30-662Z-builder-9bklnw/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=163; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T06-09-59-064Z-builder-0lzbuq critic pass task-split-oversized-a2a-push-notification-config-test- .kota/runs/2026-06-22T06-09-59-064Z-builder-0lzbuq/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=243; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T06-26-55-128Z-builder-jq2a1z critic pass task-split-oversized-a2a-channel-route-test-surface .kota/runs/2026-06-22T06-26-55-128Z-builder-jq2a1z/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=216; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T15-23-51-787Z-builder-migg5a critic pass task-split-oversized-execution-process-test-surface .kota/runs/2026-06-22T15-23-51-787Z-builder-migg5a/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=183; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T19-47-15-526Z-builder-et00ya critic pass task-handle-token-budget-module-adapter-source-size-war .kota/runs/2026-06-23T19-47-15-526Z-builder-et00ya/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=217; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

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

- Current source already contains the prompt-versioned review-scrutiny repair:
  critic verdict artifacts persist `reviewerPromptHash`, accepted critic
  reviews require file-line summary citations for reviewable work, and
  escalation ignores prompt-hashless legacy critic records.
- Source-mode detection at the task creation timestamp returned no active
  `review-scrutiny:critic:builder:modules:Unclassified` pattern; the run
  artifact is `.kota/runs/2026-06-23T23-50-26-678Z-builder-9zs48s/review-scrutiny-detection.json`.
- Focused validation passed:
  `pnpm exec vitest run src/modules/autonomy/review-scrutiny-escalation.test.ts src/modules/autonomy/critic-verdict.test.ts src/modules/autonomy/review-scrutiny.test.ts`.
- Operator-facing report/escalator validation passed:
  `pnpm exec vitest run src/modules/autonomy/report/render-review-scrutiny.test.ts src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts`.

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:critic:builder:modules:Unclassified -->
<!-- review-scrutiny-evidence-fingerprint: 1286183d0bc955ff0ee9513f27ebc44643fb6d6475d678ae872e02a3818acc17 -->
