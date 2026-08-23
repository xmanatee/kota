---
id: task-make-progress-reviewer-evidence-citation-failures
title: Make progress-reviewer evidence citation failures repairable
status: blocked
priority: p1
area: autonomy
summary: Validate progress-reviewer evidence IDs within the review-evidence agent contract and provide a bounded correction path before apply-actions. Preserve fail-closed rejection of invented IDs, but prevent a near-miss or hybrid UUID from turning otherwise valid review output into a terminal workflow dead letter.
created_at: 2026-08-15T04:08:47.554Z
updated_at: 2026-08-15T06:52:18.000Z
task_class: Meta
---
## Problem

    Validate progress-reviewer evidence IDs within the review-evidence agent contract and provide a bounded correction path before apply-actions. Preserve fail-closed rejection of invented IDs, but prevent a near-miss or hybrid UUID from turning otherwise valid review output into a terminal workflow dead letter.

## Desired Outcome

Resolve autonomy issue autonomy-issue-cb5e47a553dba6caa23a at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## Done When

- The issue's root cause is fixed or disproven with inspectable evidence.
- A typed clear observation or explicit disposition resolves the durable issue.

## Source / Intent

Issue reviewer disposition:     The referenced dead letter shows progress-reviewer completed agent review but failed in apply-actions because a follow-up cited a fabricated hybrid evidence UUID. A preceding open dead letter, dlq-fd469f02-35bf-4656-bfc6-a7bc7e3347fd, records the same failure shape. Semantic citation validation currently occurs after the agent step succeeds, so malformed output bypasses agent retry and terminally fails the workflow. This repeated local-code defect warrants repair; no owner decision is needed.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-8c912d98-2b05-4160-a77f-5cec930102db

## Product / Safety Link

This issue repair protects Product and Safety throughput by removing a durable autonomy failure or review gap before it consumes builder capacity.

## Initiative

One autonomy issue, one decision, one implementation path.

## Acceptance Evidence

-     Focused progress-reviewer workflow tests inject the malformed citation shapes from dlq-fd469f02-35bf-4656-bfc6-a7bc7e3347fd and dlq-8c912d98-2b05-4160-a77f-5cec930102db, prove they are rejected before apply-actions, and show a bounded corrected response completes successfully using exact packet IDs. An exhausted correction path must create no tasks or owner questions and retain an explicit diagnostic. Record redrive or dismissal evidence for both cited dead letters after same-shape verification.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/progress-reviewer-citation-resolution/canonical-citation-resolution.json
description: trusted-host canonical-runtime reconciliation — export dlq-fd469f02-35bf-4656-bfc6-a7bc7e3347fd and dlq-8c912d98-2b05-4160-a77f-5cec930102db with `pnpm kota workflow dlq export <id> --out <path>`; preserve each exact fabricated hybrid evidence ID from failure.reason in the named artifact; update workflow-citation-correction.test.ts to replay both source values; run the focused test; dismiss both records with `pnpm kota workflow dlq dismiss <id> --reason "superseded by verified citation-contract fix"`; and record the resulting typed cleared observation or resolved autonomy-issue-cb5e47a553dba6caa23a revision-1 projection in the artifact
```

## Status (2026-08-15 builder repair)

The production validator and bounded retry path are implemented, and synthetic
unknown-ID coverage proves rejection happens before action writers. This leased
builder worktree cannot read the canonical DLQ records, so it cannot truthfully
copy the two exact malformed citation values into a source-specific fixture.
It also cannot dismiss the canonical records or resolve the runtime-owned
autonomy issue projection. The task remains blocked until the capture above
supplies and dispositions those canonical records.

## Generated Work Provenance

Proposal key: `autonomy-issue:autonomy-issue-cb5e47a553dba6caa23a`

- Source: improver; run: 2026-08-15T01-53-11-533Z-improver-uqqhg8
  - Issue: autonomy-issue-cb5e47a553dba6caa23a; revision: 1
  - Evidence: .kota/dead-letter-queue/items.json#dlq-8c912d98-2b05-4160-a77f-5cec930102db

<!-- generated-work-proposal: {"key":"autonomy-issue:autonomy-issue-cb5e47a553dba6caa23a","provenance":[{"source":"improver","runId":"2026-08-15T01-53-11-533Z-improver-uqqhg8","issueKey":"autonomy-issue-cb5e47a553dba6caa23a","semanticRevision":1,"evidenceRefs":[".kota/dead-letter-queue/items.json#dlq-8c912d98-2b05-4160-a77f-5cec930102db"]}]} -->
