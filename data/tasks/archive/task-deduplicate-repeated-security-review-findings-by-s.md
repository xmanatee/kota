---
status: done
---

# Deduplicate repeated security-review findings by stable identity

## Problem

    Make security-review task materialization converge on one record across task states when later runs confirm the same finding and candidate identity. Merge provenance or update the existing record instead of creating another ready task, and reconcile the current duplicate progress-reviewer trust-boundary tasks.

The current duplicate has now been dispositioned explicitly:
`task-security-review-prepare-review-input-contains-proj` remains canonical and
`task-security-review-prepare-review-input-includes-proj` is dropped as
superseded while retaining its run and evidence provenance. The source
mechanism still needs to make the second materialization a no-op automatically.

## Desired Outcome

Resolve the progress-review finding identified by topic security-review:stable-finding-dedup.

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

    Directory scope 8nrg1m (kota), run-count review covering 2026-08-14T13:11:33.091Z through 2026-08-15T13:11:33.091Z. Included 20 runs, 15 tasks, 22 events, 40 artifacts, 60 git references, and six open dead letters across 163 evidence references. Task balance is Product 0, Safety 7, Platform 3, and Meta 5; no operator-journey risks were reported. Material Safety and platform delivery landed, but security-review created two ready tasks for the same stable finding and candidate identity, creating redundant actionable work while the underlying injection boundary remains unresolved. Existing task dispositions already cover the open dead-letter failure classes, so no additional dead-letter task is warranted. Exclusions include 178 policy-pruned run bodies, run/artifact/git truncation, truncated commit file lists, and 71 lower-detail evidence references. Applied action: propose one local task to make security-review task creation converge by stable finding identity; no owner question.

Evidence ids:

- task:task-security-review-prepare-review-input-contains-proj
- task:task-security-review-prepare-review-input-includes-proj
- git:commit:b2bc65a14740
- git:commit:e602de0f1855

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A focused replay of the two security-review outputs with the same finding and candidate IDs produces exactly one canonical task across all task states, retains provenance from both runs, and makes subsequent identical replays no-ops. The existing duplicate pair receives an explicit canonical/superseded disposition, and task validation passes.

- Source: progress-reviewer; run: 2026-08-15T08-59-43-792Z-progress-reviewer-fjjqgn
  - Evidence: git:commit:b2bc65a14740
  - Evidence: git:commit:e602de0f1855
  - Evidence: task:task-security-review-prepare-review-input-contains-proj
  - Evidence: task:task-security-review-prepare-review-input-includes-proj
