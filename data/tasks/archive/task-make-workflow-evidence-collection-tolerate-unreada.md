---
status: done
---

# Make workflow evidence collection tolerate unreadable run entries

## Problem

    Prevent an unreadable descendant within a run directory from failing the entire evidence-collection or workflow-dispatch operation. Record the inaccessible entry as excluded evidence and continue processing accessible artifacts.

## Desired Outcome

Resolve the progress-review finding identified by topic runtime:evidence-unreadable-paths.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer from the cited evidence.

review verdict: needs-steering
review summary:

    Directory-scoped task-count review for kota (scope 8nrg1m), covering 2026-08-14T05:18:15.949Z through 2026-08-15T05:18:15.949Z. Included evidence comprises 20 runs, 8 tasks, 4 events, 8 artifacts, 60 git references, and 6 open dead letters; policy-pruned run bodies and truncated run/git detail were excluded as recorded in the packet. Four committed builds demonstrate meaningful progress, but two ready Slack security tasks and recurring workflow-dispatch failures leave safety and runtime-reliability outcomes incomplete. Task balance is Safety 3, Platform 3, Meta 2, Product 0. Applied actions: proposed one non-duplicate follow-up for unreadable evidence paths; existing tasks already cover the security findings and progress-reviewer citation repair, and no owner decision is required.

Evidence ids:

- dead-letter:dlq-69a4e56a-2119-4b30-b661-aa07517a4d83

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused regression test creates an unreadable descendant under a run directory and proves collection completes while recording the exclusion; validation and a runtime probe show the affected dispatch can be redriven without producing another EACCES dead letter.

- Source: progress-reviewer; run: 2026-08-15T03-55-46-531Z-progress-reviewer-n7pduj
  - Evidence: dead-letter:dlq-69a4e56a-2119-4b30-b661-aa07517a4d83
