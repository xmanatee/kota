---
id: task-track-autonomy-commit-test-source-size-advisory
title: Track autonomy commit test source-size advisory
status: done
priority: p3
area: autonomy
summary: Builder run 2026-06-27T13-16-37-869Z-builder-190d42 completed the claimed-task consistency repair but its run summary still reports src/modules/autonomy/commit.test.ts at 529 lines after touched changes, above the 300-line guideline. Split focused commit/restart gate test helpers or record a narrow source-size exception rationale so future autonomy commit-test edits do not leave the same warning untracked.
created_at: 2026-06-27T13:58:43.887Z
updated_at: 2026-06-27T14:47:43.999Z
---

## Problem

Builder run 2026-06-27T13-16-37-869Z-builder-190d42 completed the claimed-task consistency repair but its run summary still reports src/modules/autonomy/commit.test.ts at 529 lines after touched changes, above the 300-line guideline. Split focused commit/restart gate test helpers or record a narrow source-size exception rationale so future autonomy commit-test edits do not leave the same warning untracked.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T13-52-39-905Z-progress-reviewer-fmuu5a.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T13-52-39-905Z-progress-reviewer-fmuu5a.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 6, Meta 0, Unclassified 13. The p1 claimed-task mismatch repair landed with passing critic and observability checks, and calibration/fan-out monitors are quiet, but the latest builder success left a new autonomy commit-test source-size advisory that needs an explicit cleanup or exception path.

Evidence ids:

- run:2026-06-27T13-16-37-869Z-builder-190d42
- artifact:2026-06-27T13-16-37-869Z-builder-190d42:run-summary.json
- git:commit:49794cc7e09a:file:3
- task:task-block-builder-claimed-task-commit-mismatches

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Split the former 529-line `src/modules/autonomy/commit.test.ts` into focused files: `commit.test.ts` (203 lines), `commit-paths.test.ts` (222 lines), `commit-test-support.ts` (103 lines), and `builder-commit-gates.test.ts` (70 lines).
- `pnpm exec vitest run src/modules/autonomy/commit.test.ts src/modules/autonomy/commit-paths.test.ts src/modules/autonomy/builder-commit-gates.test.ts` passed: 3 files, 28 tests.
- `pnpm typecheck` passed.
- `pnpm exec biome check src/modules/autonomy/commit.test.ts src/modules/autonomy/commit-paths.test.ts src/modules/autonomy/commit-test-support.ts src/modules/autonomy/builder-commit-gates.test.ts` passed.
- A temporary-index staged `checkSourceFileSize(process.cwd())` returned `OK: changed source files are under source-size warning thresholds`; `pnpm validate-tasks` passed under the same staged view.
