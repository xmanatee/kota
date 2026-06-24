---
id: task-split-oversized-review-scrutiny-escalator-workflow
title: Split oversized review-scrutiny escalator workflow test
status: done
priority: p3
area: autonomy
summary: The latest review-scrutiny repair passed, but builder metadata reported src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts at 386 lines after a 95-line change. Split focused scenarios or extract local test helpers so future review-scrutiny repairs stay reviewable without changing escalator behavior.
created_at: 2026-06-24T00:33:26.660Z
updated_at: 2026-06-24T17:56:14.133Z
---

## Problem

The latest review-scrutiny repair passed, but builder metadata reported src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts at 386 lines after a 95-line change. Split focused scenarios or extract local test helpers so future review-scrutiny repairs stay reviewable without changing escalator behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T00-28-30-365Z-progress-reviewer-c9q5e0.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T00-28-30-365Z-progress-reviewer-c9q5e0.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Platform 0, Safety 2, Meta 8, Unclassified 9. The review-scrutiny repair sequence is making progress and current monitors are quiet, but the latest repair left a new source-size advisory on the review-scrutiny escalator workflow test surface.

Evidence ids:

- run:2026-06-24T00-13-26-267Z-builder-vrx0ib
- git:commit:ab9a5bf6c523

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Split the test fixture/setup helpers into `src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test-helpers.ts`; `workflow.test.ts` now keeps the scenario assertions.
- Line-count evidence is recorded at `.kota/runs/2026-06-24T17-50-53-858Z-builder-3sgdhd/line-count-evidence.txt`: cited `workflow.test.ts` was 386 lines and is now 230 lines; the extracted helper is 157 lines. Both are below the 300-line source-size guideline in `src/modules/autonomy/source-size-check.ts`.
- `pnpm exec vitest run src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts` passed: 1 test file, 5 tests.
- `pnpm exec biome check src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test-helpers.ts` passed with no fixes applied.
- Canonical `pnpm kota task move` attempts for `doing` and `done` failed before changing files because Git could not create `.git/index.lock`; the task state and evidence were updated directly, then `git add -A` successfully staged the finished source/task changes.
