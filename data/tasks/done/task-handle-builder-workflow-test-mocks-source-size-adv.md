---
id: task-handle-builder-workflow-test-mocks-source-size-adv
title: Handle builder workflow test mocks source-size advisory
status: done
priority: p3
area: autonomy
summary: Builder run 2026-06-27T08-31-15-455Z-builder-qhdcq7 completed the merge-gate task but its source-file-size review reports src/modules/autonomy/workflows/builder/workflow-test-mocks.ts at 333 lines after touched changes, above the 300-line guideline.
created_at: 2026-06-27T10:33:08.492Z
updated_at: 2026-06-27T14:20:42.000Z
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

- Split the builder workflow worktree lifecycle test mocks into `src/modules/autonomy/workflows/builder/workflow-worktree-test-mocks.ts`; `workflow-test-mocks.ts` is now 213 lines and the new helper is 108 lines.
- Focused builder workflow tests passed: `pnpm test src/modules/autonomy/workflows/builder/workflow-worktree-mode.test.ts src/modules/autonomy/workflows/builder/workflow.test.ts src/modules/autonomy/workflows/builder/workflow-run.test.ts src/modules/autonomy/workflows/builder/workflow-repair-checks.test.ts`.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed with pre-existing info diagnostics in `workflow-root-boundary.test.ts`.
- `.kota/runs/2026-06-27T13-59-03-884Z-builder-te9m09/source-file-size-review.json` reports outcome `ok` with no warnings using the builder source-size diagnostic against a temporary staged index.
- `pnpm run validate-tasks` passed against the same temporary staged index. The real-index run is blocked by this sandbox's read-only `.git/index.lock` behavior, which also prevented the canonical `pnpm kota task move` state transitions.
