---
id: task-block-builder-claimed-task-commit-mismatches
title: Block builder claimed-task commit mismatches
status: done
priority: p1
area: autonomy
summary: Builder run 2026-06-27T13-04-14-521Z-builder-ys29is claimed task-handle-builder-workflow-test-mocks-source-size-adv but emitted and committed task-handle-model-matrix-test-source-size-advisory. Add a deterministic builder consistency gate spanning claim-task, build/run-summary, emit-build-committed, and release-task-claim so a successful run cannot release one claim while committing another task.
created_at: 2026-06-27T13:20:38.249Z
updated_at: 2026-06-27T13:29:00Z
---

## Problem

Builder run 2026-06-27T13-04-14-521Z-builder-ys29is claimed task-handle-builder-workflow-test-mocks-source-size-adv but emitted and committed task-handle-model-matrix-test-source-size-advisory. Add a deterministic builder consistency gate spanning claim-task, build/run-summary, emit-build-committed, and release-task-claim so a successful run cannot release one claim while committing another task.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T13-16-13-795Z-progress-reviewer-r03kfa.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T13-16-13-795Z-progress-reviewer-r03kfa.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 6, Meta 0, Unclassified 11. Recent source-size work landed, with no operator-journey risks or open dead letters reported, but the latest builder success mismatched its claimed task versus committed task and left a new model-matrix helper observability warning untracked.

Evidence ids:

- run:2026-06-27T13-04-14-521Z-builder-ys29is
- artifact:2026-06-27T13-04-14-521Z-builder-ys29is:builder-workspace.json
- git:commit:981c25c0edb6
- task:task-handle-builder-workflow-test-mocks-source-size-adv
- task:task-handle-model-matrix-test-source-size-advisory

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A focused builder workflow test injects a claimed-task/build-output mismatch and proves the run fails before commit emission or claim release; a matching claimed-task path still succeeds; task validation passes.
- Implemented `check-claimed-task-consistency` after `write-run-summary`; it fails if the claimed task id is missing, the summary has no task id, or the two ids differ.
- `merge-gate`, `release-task-claim`, `workflow.build.committed`, and `request-restart` now require the consistency step to pass. The emitted task id comes from the consistency artifact, not from an unchecked run summary.
- `src/modules/autonomy/workflows/builder/workflow-run.test.ts` injects a claimed-task/run-summary mismatch and asserts the run fails before `workflow.build.committed` emission or `releaseTaskClaim`; the matching claimed-task event path still succeeds.
- Repair validation: `pnpm test src/strict-types-policy.integration.test.ts src/modules/autonomy/commit.test.ts` passed after removing the new raw `unknown` usage and updating the restart-gate fixture with the consistency step.
- Repair validation: staged `source-file-size-severe` check is non-blocking; the prior `workflow-test-mocks.ts` cleanup-overlap warning is gone. The remaining advisory is `src/modules/autonomy/commit.test.ts`, touched only to align the existing restart assertion with the new consistency gate.
- Validation run for this change: `pnpm test src/modules/autonomy/workflows/builder` passed; `pnpm run typecheck` passed; touched-file `biome check` passed; `pnpm run validate-tasks` passed after final staging.
