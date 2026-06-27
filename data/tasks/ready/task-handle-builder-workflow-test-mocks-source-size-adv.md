---
id: task-handle-builder-workflow-test-mocks-source-size-adv
title: Handle builder workflow test mocks source-size advisory
status: ready
priority: p3
area: autonomy
summary: Builder run 2026-06-27T08-31-15-455Z-builder-qhdcq7 completed the merge-gate task but its source-file-size review reports src/modules/autonomy/workflows/builder/workflow-test-mocks.ts at 333 lines after touched changes, above the 300-line guideline.
created_at: 2026-06-27T10:33:08.492Z
updated_at: 2026-06-27T10:33:08.492Z
---

## Problem

Builder run 2026-06-27T08-31-15-455Z-builder-qhdcq7 completed the merge-gate task but its source-file-size review reports src/modules/autonomy/workflows/builder/workflow-test-mocks.ts at 333 lines after touched changes, above the 300-line guideline.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T10-17-13-386Z-progress-reviewer-l4in8f.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T10-17-13-386Z-progress-reviewer-l4in8f.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 7, Meta 0, Unclassified 7. The Safety merge-gate work landed and review/security paths are active, but the latest builder left an untracked source-size advisory and there is already a pending owner question for recurring builder harness aborts.

Evidence ids:

- run:2026-06-27T08-31-15-455Z-builder-qhdcq7
- git:commit:b50c3ce6dac7

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Split cohesive builder workflow test mock helpers or record a narrow source-size exception with rationale; focused builder workflow worktree-mode tests pass; a later builder/source-size diagnostic no longer reports workflow-test-mocks.ts as an untracked advisory.
