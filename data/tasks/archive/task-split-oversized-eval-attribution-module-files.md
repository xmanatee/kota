---
status: done
---

# Split oversized eval attribution module files

## Problem

The eval-attribution implementation landed with passing behavior but left src/modules/eval-harness/eval-attribution.ts and eval-attribution.test.ts far above the source-size guideline. Split the attribution implementation and focused tests into cohesive module-local helpers without changing the eval report contract.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T16-59-59-974Z-progress-reviewer-3r3h4f.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T16-59-59-974Z-progress-reviewer-3r3h4f.

review verdict: needs-steering
review summary: The 24h window shows progress but needs a small architecture follow-up. Balance: Product 0, Safety 0, Platform 7, Meta 1, Unclassified 12. DLQ and operator-journey signals are clean, and remaining blocked work has typed operator-capture preconditions, but the latest eval-attribution build introduced oversized module files without an open cleanup task.

Evidence ids:

- scope:8nrg1m:run:2026-06-20T23-44-03-227Z-builder-67alz5
- scope:8nrg1m:task:task-report-per-component-eval-attribution-for-score-mo
- scope:8nrg1m:git:commit:b3c8b8220089

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff splits the oversized eval-attribution implementation and tests into cohesive files under src/modules/eval-harness/ without changing the public eval report schema; focused eval-attribution, baseline-assessment, cli, and eval-set tests pass; builder source-size diagnostics no longer warn on the attribution files touched by this cleanup.

## Result

- Split `eval-attribution.ts` into module-local helpers for types, artifact evidence, per-fixture attribution, component attribution, diagnostics, and prior-report loading while preserving the public `eval-attribution.js` import surface.
- Split bulky test setup into `eval-attribution-test-data.ts` and `eval-attribution-test-harness.ts`; all touched attribution files are now below the 300-line source-size warning threshold.
- Acceptance evidence is recorded in `.kota/runs/2026-06-21T01-34-51-102Z-builder-x1e0oa/`.
