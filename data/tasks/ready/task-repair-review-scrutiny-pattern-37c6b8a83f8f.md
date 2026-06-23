---
id: task-repair-review-scrutiny-pattern-37c6b8a83f8f
title: Repair recurring thin critic acceptances
status: ready
priority: p2
area: autonomy
task_class: Meta
summary: Make critic reviews for builder security/Unclassified carry inspectable evidence instead of recurring thin acceptances.
created_at: 2026-06-23T22:39:45.963Z
updated_at: 2026-06-23T22:39:45.963Z
---

## Problem

Recent review-scrutiny artifacts show the same reviewer surface repeatedly
accepting work with no concrete scrutiny signal. One concise approval can
be valid; this task exists because the grouped pattern crossed the minimum
sample and thin-acceptance ratio thresholds.

Pattern fingerprint: `review-scrutiny:critic:builder:security:Unclassified`
Evidence fingerprint: `f24c1e24a91b81a97e8eaf78e387cbf64dc12f37c0c1acbd4cf751f0121c36ca`

## Review-Scrutiny Evidence

- Reviewer surface: critic
- Workflow/context: builder security/Unclassified
- Thin acceptances: 29/30 (0.97)
- Decisions: pass
- Run ids: 2026-06-17T05-26-39-846Z-builder-1a6fsm, 2026-06-17T10-14-12-398Z-builder-av2z19, 2026-06-18T15-11-22-428Z-builder-hzf9sf, 2026-06-18T23-03-16-415Z-builder-lvtg2i, 2026-06-19T12-36-55-280Z-builder-l0nrfg, 2026-06-19T14-11-38-005Z-builder-oi61e3, 2026-06-19T15-01-22-835Z-builder-3cy0x0, 2026-06-20T00-57-54-071Z-builder-2yvdx3, 2026-06-20T02-18-06-447Z-builder-620mjn, 2026-06-20T16-47-43-614Z-builder-bi6ij0, 2026-06-20T19-33-18-901Z-builder-whhgpn, 2026-06-21T06-45-21-664Z-builder-f6gf4h, 2026-06-22T00-29-09-294Z-builder-lyamru, 2026-06-22T01-23-37-392Z-builder-vokof4, 2026-06-22T02-54-44-361Z-builder-fe86vd, 2026-06-22T05-39-20-986Z-builder-9fm5ko, 2026-06-22T05-51-52-662Z-builder-29f73h, 2026-06-22T08-09-31-561Z-builder-r2ho70, 2026-06-22T08-40-19-691Z-builder-wj7722, 2026-06-22T14-19-12-546Z-builder-md55mu, 2026-06-22T14-55-07-047Z-builder-b4kqgy, 2026-06-22T16-40-20-566Z-builder-z23g4f, 2026-06-22T16-51-01-949Z-builder-0dhwhf, 2026-06-22T17-58-29-878Z-builder-jsx9sc, 2026-06-22T18-22-49-614Z-builder-ga6juk, 2026-06-22T23-00-20-701Z-builder-fp4y4e, 2026-06-23T00-29-22-841Z-builder-sxh9ge, 2026-06-23T18-18-49-271Z-builder-lbc5ha, 2026-06-23T19-26-50-632Z-builder-dy0p5t
- Task ids: task-security-review-a-stdio-mcp-server-that-receives-c, task-security-review-a2a-push-notification-callbacks-ca, task-security-review-a2a-push-notification-config-respo, task-security-review-approving-a-queued-tool-for-a-sele, task-security-review-builder-runtime-probes-execute-tas, task-security-review-confirmed-security-review-findings, task-security-review-external-fetch-consumers-read-arbi, task-security-review-http-mcp-transport-and-its-oauthpr, task-security-review-mcp-tool-names-are-constructed-by-, task-security-review-mcpauthorizationflowerror-now-reda, task-security-review-mcpauthorizationflowerror-redacts-, task-security-review-normalized-task-creation-stages-th, task-security-review-persisted-remote-mcp-task-handles-, task-security-review-queued-approval-execution-bypasses, task-security-review-queued-approvals-for-mcp-operation, task-security-review-remote-task-declaration-fingerprin, task-security-review-security-review-can-persist-unesca, task-security-review-stdio-mcp-transport-env-values-can, task-security-review-the-approval-cli-strips-ansic0c1-t, task-security-review-the-callback-non-local-guard-class, task-security-review-the-callback-url-non-local-guard-o, task-security-review-the-daemon-stop-path-trusts-the-pr, task-security-review-the-process-start-path-now-include, task-security-review-the-read-only-agentstatus-config-q, task-security-review-the-shared-config-masker-does-not-, task-security-review-the-task-show-route-accepts-a-deco, task-security-review-the-workflow-shell-teardown-guard-, task-security-review-workflow-run-ids-accepted-from-que, task-security-review-workflow-trigger-payload-run-ids-a
- Window: 2026-06-17T05:37:35.872Z to 2026-06-23T19:47:06.450Z
- Active reason: critic produced 29/30 thin approval-like decisions for builder security/Unclassified.

- 2026-06-17T05-26-39-846Z-builder-1a6fsm critic pass task-security-review-mcpauthorizationflowerror-redacts- .kota/runs/2026-06-17T05-26-39-846Z-builder-1a6fsm/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=222; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-17T10-14-12-398Z-builder-av2z19 critic pass task-security-review-mcpauthorizationflowerror-now-reda .kota/runs/2026-06-17T10-14-12-398Z-builder-av2z19/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=201; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T15-11-22-428Z-builder-hzf9sf critic pass task-security-review-stdio-mcp-transport-env-values-can .kota/runs/2026-06-18T15-11-22-428Z-builder-hzf9sf/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=136; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-18T23-03-16-415Z-builder-lvtg2i critic pass task-security-review-the-approval-cli-strips-ansic0c1-t .kota/runs/2026-06-18T23-03-16-415Z-builder-lvtg2i/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=182; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T12-36-55-280Z-builder-l0nrfg critic pass task-security-review-external-fetch-consumers-read-arbi .kota/runs/2026-06-19T12-36-55-280Z-builder-l0nrfg/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=222; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T14-11-38-005Z-builder-oi61e3 critic pass task-security-review-http-mcp-transport-and-its-oauthpr .kota/runs/2026-06-19T14-11-38-005Z-builder-oi61e3/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=209; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-19T15-01-22-835Z-builder-3cy0x0 critic pass task-security-review-approving-a-queued-tool-for-a-sele .kota/runs/2026-06-19T15-01-22-835Z-builder-3cy0x0/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=212; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T00-57-54-071Z-builder-2yvdx3 critic pass task-security-review-security-review-can-persist-unesca .kota/runs/2026-06-20T00-57-54-071Z-builder-2yvdx3/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=223; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T02-18-06-447Z-builder-620mjn critic pass task-security-review-confirmed-security-review-findings .kota/runs/2026-06-20T02-18-06-447Z-builder-620mjn/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=237; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T16-47-43-614Z-builder-bi6ij0 critic pass task-security-review-workflow-run-ids-accepted-from-que .kota/runs/2026-06-20T16-47-43-614Z-builder-bi6ij0/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=192; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-20T19-33-18-901Z-builder-whhgpn critic pass task-security-review-the-daemon-stop-path-trusts-the-pr .kota/runs/2026-06-20T19-33-18-901Z-builder-whhgpn/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=204; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-21T06-45-21-664Z-builder-f6gf4h critic pass task-security-review-builder-runtime-probes-execute-tas .kota/runs/2026-06-21T06-45-21-664Z-builder-f6gf4h/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=202; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T00-29-09-294Z-builder-lyamru critic pass task-security-review-a-stdio-mcp-server-that-receives-c .kota/runs/2026-06-22T00-29-09-294Z-builder-lyamru/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=204; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T01-23-37-392Z-builder-vokof4 critic pass task-security-review-the-task-show-route-accepts-a-deco .kota/runs/2026-06-22T01-23-37-392Z-builder-vokof4/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=187; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T02-54-44-361Z-builder-fe86vd critic pass task-security-review-normalized-task-creation-stages-th .kota/runs/2026-06-22T02-54-44-361Z-builder-fe86vd/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=202; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T05-39-20-986Z-builder-9fm5ko critic pass task-security-review-a2a-push-notification-callbacks-ca .kota/runs/2026-06-22T05-39-20-986Z-builder-9fm5ko/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=239; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T05-51-52-662Z-builder-29f73h critic pass task-security-review-the-callback-url-non-local-guard-o .kota/runs/2026-06-22T05-51-52-662Z-builder-29f73h/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=192; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T08-09-31-561Z-builder-r2ho70 critic pass task-security-review-a2a-push-notification-config-respo .kota/runs/2026-06-22T08-09-31-561Z-builder-r2ho70/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=203; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T08-40-19-691Z-builder-wj7722 critic pass task-security-review-the-callback-non-local-guard-class .kota/runs/2026-06-22T08-40-19-691Z-builder-wj7722/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=236; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T14-19-12-546Z-builder-md55mu critic pass task-security-review-workflow-trigger-payload-run-ids-a .kota/runs/2026-06-22T14-19-12-546Z-builder-md55mu/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=231; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T14-55-07-047Z-builder-b4kqgy critic pass task-security-review-the-process-start-path-now-include .kota/runs/2026-06-22T14-55-07-047Z-builder-b4kqgy/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=187; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T16-40-20-566Z-builder-z23g4f critic pass task-security-review-mcp-tool-names-are-constructed-by- .kota/runs/2026-06-22T16-40-20-566Z-builder-z23g4f/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=207; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T16-51-01-949Z-builder-0dhwhf critic pass task-security-review-persisted-remote-mcp-task-handles- .kota/runs/2026-06-22T16-51-01-949Z-builder-0dhwhf/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=173; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T17-58-29-878Z-builder-jsx9sc critic pass task-security-review-the-workflow-shell-teardown-guard- .kota/runs/2026-06-22T17-58-29-878Z-builder-jsx9sc/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=183; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T18-22-49-614Z-builder-ga6juk critic pass task-security-review-remote-task-declaration-fingerprin .kota/runs/2026-06-22T18-22-49-614Z-builder-ga6juk/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=226; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-22T23-00-20-701Z-builder-fp4y4e critic pass task-security-review-the-read-only-agentstatus-config-q .kota/runs/2026-06-22T23-00-20-701Z-builder-fp4y4e/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=246; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T00-29-22-841Z-builder-sxh9ge critic pass task-security-review-the-shared-config-masker-does-not- .kota/runs/2026-06-23T00-29-22-841Z-builder-sxh9ge/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=162; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T18-18-49-271Z-builder-lbc5ha critic pass task-security-review-queued-approval-execution-bypasses .kota/runs/2026-06-23T18-18-49-271Z-builder-lbc5ha/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=291; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount
- 2026-06-23T19-26-50-632Z-builder-dy0p5t critic pass task-security-review-queued-approvals-for-mcp-operation .kota/runs/2026-06-23T19-26-50-632Z-builder-dy0p5t/critic-review.json; signals: issueCount=0, warningCount=0, reviewBodyLength=235; absent: evidenceIdCount, findingCount, followUpTaskCount, citedFileLineCount

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

<!-- review-scrutiny-pattern-fingerprint: review-scrutiny:critic:builder:security:Unclassified -->
<!-- review-scrutiny-evidence-fingerprint: f24c1e24a91b81a97e8eaf78e387cbf64dc12f37c0c1acbd4cf751f0121c36ca -->
