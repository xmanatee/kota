---
id: task-move-builder-claimed-task-consistency-before-commi
title: Move builder claimed-task consistency before commit
status: ready
priority: p1
area: autonomy
summary: Builder run 2026-06-28T12-36-26-477Z-builder-hd8dph claimed task-add-open-knowledge-format-compatibility-to-knowled but committed task-security-review-the-approve-all-control-path-prefl before the claimed-task consistency check failed. Move the mismatch gate before git commit and recover this mismatch shape so failed builders cannot land unrelated commits or strand claims.
created_at: 2026-06-28T13:11:09.624Z
updated_at: 2026-06-28T13:11:09.624Z
---

## Problem

Builder run 2026-06-28T12-36-26-477Z-builder-hd8dph claimed task-add-open-knowledge-format-compatibility-to-knowled but committed task-security-review-the-approve-all-control-path-prefl before the claimed-task consistency check failed. Move the mismatch gate before git commit and recover this mismatch shape so failed builders cannot land unrelated commits or strand claims.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T12-51-40-760Z-progress-reviewer-lozh44.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 1, Safety 1, Platform 1, Meta 0, Unclassified 6. Product and security work landed with no operator-journey risk, but the latest builder committed one task while holding another claim, failed only after commit, and the scope still has open dead letters.

Evidence ids:

- run:2026-06-28T12-36-26-477Z-builder-hd8dph
- dead-letter:dlq-77f2249b-48e5-4c00-b1e8-a9b8784ca2a7
- git:commit:a0cd7bee2005
- task:task-add-open-knowledge-format-compatibility-to-knowled
- task:task-security-review-the-approve-all-control-path-prefl
- task:task-block-builder-claimed-task-commit-mismatches

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Focused builder workflow tests reproduce the current claimed-task/run-summary mismatch and prove no git commit is attempted, workflow.build.committed is not emitted, and the claimed task is released, marked retryable, or recovered with durable rationale; dlq-77f2249b-48e5-4c00-b1e8-a9b8784ca2a7 is cleared or superseded after validation.
