---
id: task-handle-model-matrix-test-source-size-advisory
title: Handle model-matrix test source-size advisory
status: ready
priority: p3
area: modules
summary: Builder run 2026-06-27T12-43-12-849Z-builder-ezl2z6 completed scaffold model-matrix observability evidence but reported src/modules/harness-parity/model-matrix.test.ts at 342 lines after 42 changed lines, above the 300-line source-size guideline. Split cohesive assertions or helpers, or record a narrow source-size cleanup exception without weakening scaffold evidence coverage.
created_at: 2026-06-27T13:00:58.665Z
updated_at: 2026-06-27T13:00:58.665Z
---

## Problem

Builder run 2026-06-27T12-43-12-849Z-builder-ezl2z6 completed scaffold model-matrix observability evidence but reported src/modules/harness-parity/model-matrix.test.ts at 342 lines after 42 changed lines, above the 300-line source-size guideline. Split cohesive assertions or helpers, or record a narrow source-size cleanup exception without weakening scaffold evidence coverage.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T12-56-58-380Z-progress-reviewer-im3ik4.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T12-56-58-380Z-progress-reviewer-im3ik4.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 6, Meta 0, Unclassified 10. The three counted builds completed and the prior observability/security gaps are resolved, but the latest scaffold evidence build left a new untracked source-size advisory on src/modules/harness-parity/model-matrix.test.ts.

Evidence ids:

- event:evtj-000000116771
- git:commit:9cb37735e1b5
- task:task-add-observability-evidence-for-scaffold-model-matr

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts for src/modules/harness-parity/model-matrix.test.ts and any extracted helper files; staged source-size diagnostics no longer report this file or a valid narrow exception is recorded; focused model-matrix tests and validate-tasks pass.
