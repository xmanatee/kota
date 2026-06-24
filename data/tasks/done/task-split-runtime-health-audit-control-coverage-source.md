---
id: task-split-runtime-health-audit-control-coverage-source
title: Split runtime health audit control coverage source-size surface
status: done
priority: p3
area: autonomy
summary: Builder run 2026-06-24T15-55-14-485Z-builder-k4k45m closed the stale skipped approval-gate security task, but its source-file-size review reported src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.test.ts at 485 lines and runtime-health-audit-control-coverage.ts at 348 lines after touched changes.
created_at: 2026-06-24T17:37:39.347Z
updated_at: 2026-06-24T18:15:16.230Z
---

## Problem

Builder run 2026-06-24T15-55-14-485Z-builder-k4k45m closed the stale skipped approval-gate security task, but its source-file-size review reported src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit-control-coverage.test.ts at 485 lines and runtime-health-audit-control-coverage.ts at 348 lines after touched changes.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T17-27-52-021Z-progress-reviewer-uipru7.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T17-27-52-021Z-progress-reviewer-uipru7.

review verdict: needs-steering
review summary: Needs steering. Balance: Safety 4, Product 1, Platform 6, Meta 1, Unclassified 8. The security finding was closed, calibration and fan-out monitors are quiet, and there are no open dead letters or operator-journey risks, but the latest builder left new source-size advisories on autonomy-health-reviewer files without an active matching follow-up.

Evidence ids:

- run:2026-06-24T15-55-14-485Z-builder-k4k45m
- task:task-security-review-the-stale-skipped-approval-gate-su
- git:commit:0e76099c3b7a
- git:commit:0e76099c3b7a:file:3
- git:commit:0e76099c3b7a:file:4

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Split `runtime-health-audit-control-coverage.ts` from 348 lines into `runtime-health-audit-control-coverage.ts` at 214 lines and `runtime-health-audit-control-coverage-gates.ts` at 141 lines.
- Split `runtime-health-audit-control-coverage.test.ts` from 485 lines into `runtime-health-audit-control-coverage.test.ts` at 275 lines and `runtime-health-audit-control-coverage-test-support.ts` at 238 lines.
- Focused test passed: `.kota/runs/2026-06-24T18-02-58-232Z-builder-4wf2qh/focused-test.txt`.
- Biome passed on the touched source files: `.kota/runs/2026-06-24T18-02-58-232Z-builder-4wf2qh/biome-check.txt`.
- Equivalent unstaged source-size check using KOTA's source-size parser passed: `.kota/runs/2026-06-24T18-02-58-232Z-builder-4wf2qh/source-size-unstaged-check.txt`.
- Canonical `pnpm kota task move` and final staging could not write `.git/index.lock` in this sandbox; the failure is recorded at `.kota/runs/2026-06-24T18-02-58-232Z-builder-4wf2qh/task-move-attempt.txt`.
