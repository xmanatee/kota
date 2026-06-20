---
id: task-split-oversized-security-review-workflow-test
title: Split oversized security-review workflow test
status: done
priority: p3
area: autonomy
summary: The latest security-review fix completed but emitted a source-file-size warning because src/modules/autonomy/workflows/security-review/workflow.test.ts is over the source-size guideline after the new regressions. Split repeated setup, fixtures, or focused cases into smaller co-located test/helper files while preserving the confirmed-finding regressions.
created_at: 2026-06-20T02:31:27.976Z
updated_at: 2026-06-20T18:31:54.000Z
---

## Problem

The latest security-review fix completed but emitted a source-file-size warning because src/modules/autonomy/workflows/security-review/workflow.test.ts is over the source-size guideline after the new regressions. Split repeated setup, fixtures, or focused cases into smaller co-located test/helper files while preserving the confirmed-finding regressions.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T02-28-10-014Z-progress-reviewer-2fbx6f.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T02-28-10-014Z-progress-reviewer-2fbx6f.

review verdict: needs-steering
review summary: Kota is progressing but still needs steering: Product 0, Safety 2, Platform 7, Meta 2, Unclassified 9. The three build-commit batch closed the two refactor tasks and the terminal-task security finding, but one owner/setup question remains pending and the latest security fix surfaced an oversized security-review workflow test file needing a narrow follow-up.

Evidence ids:

- run:2026-06-20T02-18-06-447Z-builder-620mjn
- git:commit:272b868faeb8:file:4
- task:task-refactor-oversized-builder-and-security-review-wor

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before line count: `git show 272b868faeb8:src/modules/autonomy/workflows/security-review/workflow.test.ts | wc -l` reports 1001 lines for the cited oversized commit.
- After line count: `wc -l src/modules/autonomy/workflows/security-review/workflow.test.ts` reports 105 lines in the repaired tree.
- Co-located split files under `src/modules/autonomy/workflows/security-review/`: `workflow-finding-run.test-cases.ts` 293 lines, `workflow-run.test-cases.ts` 153 lines, `workflow-scan.test-cases.ts` 266 lines, `workflow-task.test-cases.ts` 264 lines, and `workflow-test-fixture.ts` 117 lines.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/autonomy/workflows/security-review/workflow.test.ts` passed: 1 test file and 19 tests passed in 2.13s.
- `pnpm typecheck` passed and ran `tsc --noEmit`.
- Additional run artifact: `.kota/runs/2026-06-20T17-20-08-793Z-builder-2mz48v/acceptance-evidence.md`.
