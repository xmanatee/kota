---
id: task-track-core-workflow-testing-source-size-advisory
title: Track core workflow testing source-size advisory
status: ready
priority: p3
area: platform
summary: Builder run 2026-06-27T06-09-10-237Z-builder-ppmxgl completed successfully but still recorded a source-size advisory for touched src/core/workflow/testing/index.ts at 669 lines. Split cohesive test helpers or record a narrow cleanup exception so future core workflow edits do not leave this advisory untracked.
created_at: 2026-06-27T07:02:16.621Z
updated_at: 2026-06-27T07:02:16.621Z
---

## Problem

Builder run 2026-06-27T06-09-10-237Z-builder-ppmxgl completed successfully but still recorded a source-size advisory for touched src/core/workflow/testing/index.ts at 669 lines. Split cohesive test helpers or record a narrow cleanup exception so future core workflow edits do not leave this advisory untracked.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T06-57-38-520Z-progress-reviewer-5djmsr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T06-57-38-520Z-progress-reviewer-5djmsr.

review verdict: needs-steering
review summary: Strategic Platform work is progressing and control checks look healthy, but the latest builder run left an untracked p3 source-size advisory for a touched core workflow test helper.

Evidence ids:

- run:2026-06-27T06-09-10-237Z-builder-ppmxgl
- git:commit:cbd1b0ea0e62

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts are recorded for src/core/workflow/testing/index.ts and any extracted helpers; staged source-size diagnostics no longer warn for this touched core workflow testing helper, or a narrow typed cleanup exception is recorded; focused core workflow tests, typecheck, and task validation pass.
