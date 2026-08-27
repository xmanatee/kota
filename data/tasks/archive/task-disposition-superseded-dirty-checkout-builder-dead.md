---
status: done
---

# Disposition superseded dirty-checkout builder dead letter

## Problem

    Resolve dlq-a5b25dd4-77c7-4bf4-929b-15dd3deadaf0 after the dirty-checkout preservation fix and subsequent successful builder run. Confirm that no unique security-review changes remain stranded, then dismiss the item as superseded or safely redrive it to a terminal result.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-25T16-15-58-223Z-progress-reviewer-ljg3k9.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

Dead letter `dlq-a5b25dd4-77c7-4bf4-929b-15dd3deadaf0` was dismissed through
KOTA's authenticated daemon control route. Redrive was rejected because the
failure was a merge-gate checkout condition, not unfinished task execution:
commit `ee01b83cc67f` changed dirty-checkout handling to preserve the builder
branch, and run `2026-07-25T15-52-06-334Z-builder-e7it1w` subsequently merged
the same claimed task successfully.

The four security-review paths named by the failed merge gate are exactly the
four paths changed by landed commit `18a12e397024`. A separate older
defensive-review worktree still has additional local changes, but it remains
preserved and attributed to
`task-restore-defensive-security-review-after-classifier`; those changes were
not created by, and were not discarded with, this dead-letter disposition.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-25T16-15-58-223Z-progress-reviewer-ljg3k9.

review verdict: needs-steering
review summary:

    Two substantive Safety and Meta outcomes reached done, while the recovery build honestly exposed a trusted-host blocker rather than claiming completion. Steering remains necessary because three dead letters are open and the latest dirty-checkout builder item lacks terminal disposition. Task balance: 0 Product, 6 Safety, 2 Platform, 10 Meta, and 2 Unclassified; no operator-journey risks were reported.

Evidence ids:

- dead-letter:dlq-a5b25dd4-77c7-4bf4-929b-15dd3deadaf0
- git:commit:ee01b83cc67f
- event:evtj-000000175457
- run:2026-07-25T15-52-06-334Z-builder-e7it1w

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A run artifact records the dead letter before and after disposition; verifies whether commit ee01b83cc67f and the later successful builder run supersede its dirty-checkout failure; confirms preserved security-review changes were merged or explicitly superseded; and shows the item dismissed or redriven with durable rationale and absent from the open builder dead-letter projection.
- `.kota/runs/2026-07-25T16-18-47-137Z-builder-mp7c4x/dead-letter-before-dismissal.json`
  preserves the canonical open item and failed run.
- `.kota/runs/2026-07-25T16-18-47-137Z-builder-mp7c4x/dead-letter-after-dismissal.json`
  records the authenticated dismissal time and stored rationale.
- `.kota/runs/2026-07-25T16-18-47-137Z-builder-mp7c4x/dead-letter-resolution.md`
  ties the exact dirty path set to `18a12e397024`, verifies the later merged
  builder run, and distinguishes the separately preserved defensive-review
  worktree.
- `.kota/runs/2026-07-25T16-18-47-137Z-builder-mp7c4x/open-builder-dead-letters.json`
  records an empty filtered open-builder projection after dismissal.
