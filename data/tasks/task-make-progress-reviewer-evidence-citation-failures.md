---
status: blocked
priority: p1
---
# Make progress-reviewer evidence citation failures repairable

## Problem

    Validate progress-reviewer evidence IDs within the review-evidence agent contract and provide a bounded correction path before apply-actions. Preserve fail-closed rejection of invented IDs, but prevent a near-miss or hybrid UUID from turning otherwise valid review output into a terminal workflow dead letter.

## Desired Outcome

Progress-review output is validated against the exact evidence packet before
any action writer runs. Unknown or malformed citations receive one bounded
correction attempt; exhaustion records a typed diagnostic without creating
tasks, owner questions, or a terminal dead letter.

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

Existing focused workflow coverage must demonstrate correction before action application and fail-closed exhaustion without task/question writes. Preserve the available historical citation evidence. For records absent from the current DLQ, record absence rather than demanding export, recreation, or dismissal. Resolve any still-live matching issue through its owning mechanism.

## Blocked on

```
kind: operator-capture
path: .kota/runs/blocked-task-review-2026-09-07/task-make-progress-reviewer-evidence-citation-failures.diagnostics.json
description: inspectable host diagnostics for final task review; no canonical credentials required
```

## Operational evidence (2026-09-07)

The two historical DLQ records are absent from the current store; they cannot be exported or dismissed now. Do not recreate them or require their exact records as a completion gate. A retained evidence packet in .kota/runs/2026-08-15T14-27-08-197Z-progress-reviewer-u148pd/metadata.json preserves the scoped malformed citation scope:8nrg1m:dead-letter:dlq-f084687d-a51d-4b30-b661-aa07517a4d83 and its rejection.

The existing workflow-citation-correction.test.ts already exercises both scoped and unscoped forms of that malformed ID. Its two behavioral scenarios passed on 2026-09-07: correction before action application, and fail-closed exhaustion without creating tasks/questions. No new test or source change was needed for this verification.

Review this current contract and close the task if it is satisfied; retain source absence honestly rather than blocking indefinitely on expired records. Do not infer that absence proves a historical dismissal or modify unrelated runtime state.

## Prior implementation

The production citation validator and bounded correction path are implemented. The former operator-capture restriction is superseded by the evidence above.

- Source: improver; run: 2026-08-15T01-53-11-533Z-improver-uqqhg8
  - Issue: autonomy-issue-cb5e47a553dba6caa23a; revision: 1
  - Evidence: .kota/dead-letter-queue/items.json#dlq-8c912d98-2b05-4160-a77f-5cec930102db