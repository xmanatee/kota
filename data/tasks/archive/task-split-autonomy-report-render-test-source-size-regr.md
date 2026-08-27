---
status: done
---

# Split autonomy report render test source-size regression

## Problem

The owner-intervention pressure build passed, but its builder source-size review reports src/modules/autonomy/report/render.test.ts at 302 lines after the report rendering changes. Split focused render-test scenarios or extract local test helpers so future autonomy report changes stay below the source-size guideline without changing report behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T09-27-31-901Z-progress-reviewer-8sbpra.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T09-27-31-901Z-progress-reviewer-8sbpra.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Safety 7, Platform 2, Meta 4, Unclassified 7. Recent monitored runs landed owner-intervention reporting with clean critic/calibration signals, but the builder left a new autonomy report render-test source-size advisory not covered by an open task.

Evidence ids:

- run:2026-06-24T09-06-11-675Z-builder-6kxvuh
- git:commit:48638d31a333:file:11
- task:task-handle-autonomy-report-source-size-warnings

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Initial line count showed `src/modules/autonomy/report/render.test.ts` at 302 lines; after splitting the populated-data scenario into `src/modules/autonomy/report/render-populated.test.ts`, `wc -l` reports 117 lines for `render.test.ts` and 191 lines for the new focused test file.
- `pnpm exec vitest run src/modules/autonomy/report/render.test.ts src/modules/autonomy/report/render-populated.test.ts src/modules/autonomy/report/render-owner-interventions.test.ts` passed 3 files and 6 tests.
- `pnpm test -- src/modules/autonomy/report/render.test.ts src/modules/autonomy/report/render-populated.test.ts src/modules/autonomy/report/render-owner-interventions.test.ts` completed cleanly while expanding to the full suite: 917 files passed, 11,559 tests passed, 8 skipped.
- `pnpm run typecheck` passed.
- Staged source-size review reported `OK: changed source files are under source-size warning thresholds`.
- `pnpm run validate-tasks` passed.

## Result

Split the broad populated autonomy-report renderer scenario into its own focused test file. Report rendering behavior is unchanged, and the cited source-size advisory on `render.test.ts` is resolved by line-count evidence.
