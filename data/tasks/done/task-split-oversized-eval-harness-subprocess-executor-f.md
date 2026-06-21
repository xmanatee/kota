---
id: task-split-oversized-eval-harness-subprocess-executor-f
title: Split oversized eval-harness subprocess executor files
status: done
priority: p3
area: modules
summary: The eval-harness host-subprocess security fix passed but recorded source-file-size warnings for src/modules/eval-harness/eval-operations.ts, src/modules/eval-harness/subprocess-executor.test.ts, and src/modules/eval-harness/subprocess-executor.ts. Split cohesive helpers and tests without changing host subprocess behavior.
created_at: 2026-06-21T08:06:00.035Z
updated_at: 2026-06-21T09:08:10.518Z
---

## Problem

The eval-harness host-subprocess security fix passed but recorded source-file-size warnings for src/modules/eval-harness/eval-operations.ts, src/modules/eval-harness/subprocess-executor.test.ts, and src/modules/eval-harness/subprocess-executor.ts. Split cohesive helpers and tests without changing host subprocess behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T08-02-13-992Z-progress-reviewer-5i9mr9.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T08-02-13-992Z-progress-reviewer-5i9mr9.

review verdict: needs-steering
review summary: KOTA is progressing, but needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 7, Meta 1, Unclassified 9. The three build commits closed two security findings and a DLQ cleanup with critic passes and no open dead letters, but the latest eval-harness security fix left touched source files over the source-size guideline with no duplicate active cleanup found.

Evidence ids:

- run:2026-06-21T07-50-16-277Z-builder-qlt15l
- task:task-security-review-the-eval-harness-host-subprocess-e
- git:commit:330a19d63511

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff reduces or splits the cited eval-harness files so builder source-size diagnostics no longer warn on those changed files; focused host subprocess tests pass; typecheck, biome, and validate-tasks pass; before/after line counts are recorded in the task or run artifact.
- Before/after line counts recorded in `.kota/runs/2026-06-21T08-53-09-482Z-builder-e8cjyw/source-size-line-counts.txt`: the cited files moved from 315 / 1124 / 1175 lines to focused files all under 300 lines.
- `pnpm exec vitest run src/modules/eval-harness/subprocess-executor*.test.ts` passed: 5 test files, 22 tests.
- `pnpm run typecheck` passed.
- `pnpm run lint` passed.
- `pnpm run validate-tasks` passed after `git add -A` staged the task move.
