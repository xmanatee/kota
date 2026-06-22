---
id: task-split-oversized-execution-process-test-surface
title: Split oversized execution process test surface
status: ready
priority: p3
area: modules
summary: The process initial-output truncation fix passed, but its builder source-size review still reported src/modules/execution/process.test.ts at 527 lines after touching it for regression coverage. Split cohesive process test scenarios or shared helpers without changing execution behavior.
created_at: 2026-06-22T15:09:11.164Z
updated_at: 2026-06-22T15:09:11.164Z
---

## Problem

The process initial-output truncation fix passed, but its builder source-size review still reported src/modules/execution/process.test.ts at 527 lines after touching it for regression coverage. Split cohesive process test scenarios or shared helpers without changing execution behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T15-05-00-274Z-progress-reviewer-xpi9bp.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T15-05-00-274Z-progress-reviewer-xpi9bp.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 3, Meta 1, Unclassified 15. Recent builder and monitor outcomes are healthy, and the open progress-reviewer dead letter plus owner questions are already represented, but the latest builder left a new untracked source-size advisory on src/modules/execution/process.test.ts that needs one narrow p3 cleanup task.

Evidence ids:

- run:2026-06-22T14-55-07-047Z-builder-b4kqgy
- git:commit:125b6756318f:file:4
- task:task-security-review-the-process-start-path-now-include

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts show src/modules/execution/process.test.ts no longer triggers the 300-line source-size guideline, or a narrow justified exception is recorded; focused process tests pass; typecheck, Biome, and validate-tasks pass.
