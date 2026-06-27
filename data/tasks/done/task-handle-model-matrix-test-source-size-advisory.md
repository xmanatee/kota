---
id: task-handle-model-matrix-test-source-size-advisory
title: Handle model-matrix test source-size advisory
status: done
priority: p3
area: modules
summary: Builder run 2026-06-27T12-43-12-849Z-builder-ezl2z6 completed scaffold model-matrix observability evidence but reported src/modules/harness-parity/model-matrix.test.ts at 342 lines after 42 changed lines, above the 300-line source-size guideline. Split cohesive assertions or helpers, or record a narrow source-size cleanup exception without weakening scaffold evidence coverage.
created_at: 2026-06-27T13:00:58.665Z
updated_at: 2026-06-27T13:08:57.013Z
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

## Result

Split the reusable synthetic scenario and fixing harness into `src/modules/harness-parity/model-matrix.test-support.ts`.

## Acceptance Evidence

- Line counts: `src/modules/harness-parity/model-matrix.test.ts` went from 342 to 282 lines; `src/modules/harness-parity/model-matrix.test-support.ts` is 69 lines.
- Source-size detector over the model-matrix working diff returned `warnings: []`.
- `pnpm test src/modules/harness-parity/model-matrix.test.ts` passed.
- `pnpm exec biome check src/modules/harness-parity/model-matrix.test.ts src/modules/harness-parity/model-matrix.test-support.ts` passed.
- `pnpm run typecheck` passed.
- Run artifact `.kota/runs/2026-06-27T13-04-14-521Z-builder-ys29is/success-criteria-verified.txt` records final task validation.
