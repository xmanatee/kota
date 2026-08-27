---
status: done
---

# Track core workflow testing source-size advisory

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

Resolved in builder run 2026-06-27T08-06-19-202Z-builder-dti9px.

Before:

- `src/core/workflow/testing/index.ts`: 669 lines, with an advisory source-size warning in `.kota/runs/2026-06-27T06-09-10-237Z-builder-ppmxgl/source-file-size-review.json`.

After:

- `src/core/workflow/testing/index.ts`: 133 lines.
- `src/core/workflow/testing/results.ts`: 89 lines.
- `src/core/workflow/testing/execution-state.ts`: 198 lines.
- `src/core/workflow/testing/execute-leaf-step.ts`: 157 lines.
- `src/core/workflow/testing/execute-control-flow.ts`: 140 lines.
- `src/core/workflow/testing/execute-foreach-step.ts`: 180 lines.
- `src/core/workflow/testing/step-executor.ts`: 33 lines.

Validation:

- `pnpm exec vitest run src/core/workflow/testing src/core/workflow/steps/branch-step.test.ts src/core/workflow/steps/approval-step.test.ts src/modules/autonomy/workflows/builder/workflow.test.ts src/modules/autonomy/workflows/builder/workflow-run.test.ts src/modules/autonomy/workflows/decomposer/workflow.test.ts src/modules/autonomy/workflows/github-mention-intake/workflow.test.ts` passed: 8 files, 75 tests.
- `pnpm run typecheck` passed.
- `pnpm exec vitest run src/strict-types-policy.integration.test.ts` passed.
- Real-index `checkSevereSourceFileSizeForRun` passed and wrote `.kota/runs/2026-06-27T08-06-19-202Z-builder-dti9px/source-file-size-review.json` with `outcome: "ok"`.
- `pnpm run validate-tasks` passed after staging.
