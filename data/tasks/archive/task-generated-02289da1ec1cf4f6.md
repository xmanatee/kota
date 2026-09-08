---
status: done
---
# Repair progress-reviewer workflow execution failure

## Problem

Investigate and resolve the progress-reviewer workflow runtime execution failure recorded in dead letter dlq-0c7fd625-2cc8-4729-97a2-e2e29ee90ec8. Ensure step execution, evidence collection, and action handling complete cleanly without unhandled execution crashes.

## Desired Outcome

Resolve autonomy issue autonomy-issue-f622fdb7c1880fa02983 at semantic revision 1.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

A focused regression test verifies the progress-reviewer execution failure condition, proves it executes or recovers cleanly without dead-lettering, and passes typecheck and task validation.

## Context

Issue reviewer disposition:     Dead letter dlq-0c7fd625-2cc8-4729-97a2-e2e29ee90ec8 records an execution failure during progress-reviewer workflow execution. This local-code error is unowned by any active task. Create one builder task to investigate the failure, harden execution and error handling in the progress-reviewer workflow and runtime, and verify clean completion.


Evidence:

- dead-letter: .kota/dead-letter-queue/items.json#dlq-0c7fd625-2cc8-4729-97a2-e2e29ee90ec8

## Resolution

2026-09-08: Runtime supplied the cited dead-letter export in the builder run's issue-evidence.json and restored development dependencies. Earlier investigation was blocked on those prerequisites; both are now resolved. The original record identifies collectProgressReviewEvidenceInWorker failing on control-monitor-coverage-gap-sample/metadata.json because its successful agent step omitted required usage data. Three further captured dead letters repeat the same error.

Progress-review run evidence now catches typed metadata-file errors per historical run, excludes that run with its diagnostic in the review packet, and continues collecting valid evidence. The strict shared decoder, direct run lookup, and historical source file remain unchanged. The local collector instructions document this ownership boundary. Stable issue autonomy-issue-f622fdb7c1880fa02983 and semantic revision 1 retain their original provenance above.

The focused workflow regression reproduced the exact blocking-operation metadata.steps.0 failure before the fix. After the fix, the real workflow executor and evidence worker complete review and action handling successfully with a controlled agent port; valid recent run evidence remains available, the exclusion reaches the agent and final artifact, and malformed metadata remains rejected by direct lookup and unmodified on disk. Both evidence-integrity tests pass. Production and test TypeScript checks and focused Biome checks pass.

The broader reviewer suite exposed five existing Git-evidence/citation failures, all reproduced with the production repair removed; baseline output is retained in the run directory as baseline-review-tests.txt. They do not exercise this metadata repair. No live daemon redrive or canonical issue-state mutation was performed; runtime owns publication and subsequent issue reconciliation.