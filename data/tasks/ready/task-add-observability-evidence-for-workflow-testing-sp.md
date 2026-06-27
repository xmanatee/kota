---
id: task-add-observability-evidence-for-workflow-testing-sp
title: Add observability evidence for workflow testing split helpers
status: ready
priority: p2
area: platform
summary: Builder run 2026-06-27T08-06-19-202Z-builder-dti9px resolved the core workflow testing source-size advisory, but its observability-obligation diagnostic still reports missing inspectable evidence for src/core/workflow/testing/index.ts and src/core/workflow/testing/results.ts after runtime-sensitive workflow testing changes.
created_at: 2026-06-27T08:30:40.779Z
updated_at: 2026-06-27T08:30:40.779Z
---

## Problem

Builder run 2026-06-27T08-06-19-202Z-builder-dti9px resolved the core workflow testing source-size advisory, but its observability-obligation diagnostic still reports missing inspectable evidence for src/core/workflow/testing/index.ts and src/core/workflow/testing/results.ts after runtime-sensitive workflow testing changes.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T08-25-28-718Z-progress-reviewer-ri0f8l.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T08-25-28-718Z-progress-reviewer-ri0f8l.

review verdict: needs-steering
review summary: Recent KOTA activity is mostly on track: Safety 1, Platform 10, Product 0, Meta 0, Unclassified 8, with no reported operator-journey risks or open dead letters. Steering is needed because the latest successful builder run closed the source-size task but left a concrete observability-obligation warning for two workflow testing split files.

Evidence ids:

- run:2026-06-27T08-06-19-202Z-builder-dti9px
- artifact:2026-06-27T08-06-19-202Z-builder-dti9px:observability-obligation-review.json
- git:commit:af2edc368765

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up builder run or explicit run artifact maps src/core/workflow/testing/index.ts and src/core/workflow/testing/results.ts to structured logging, typed events, explicit error-result evidence, focused test assertions, or an explicit observability-obligation rationale; the diagnostic reports no unresolved missing files or a justified waiver; focused workflow testing tests and task validation pass.
