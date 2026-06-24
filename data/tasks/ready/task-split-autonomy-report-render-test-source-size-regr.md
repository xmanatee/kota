---
id: task-split-autonomy-report-render-test-source-size-regr
title: Split autonomy report render test source-size regression
status: ready
priority: p3
area: autonomy
summary: The owner-intervention pressure build passed, but its builder source-size review reports src/modules/autonomy/report/render.test.ts at 302 lines after the report rendering changes. Split focused render-test scenarios or extract local test helpers so future autonomy report changes stay below the source-size guideline without changing report behavior.
created_at: 2026-06-24T09:46:27.977Z
updated_at: 2026-06-24T09:46:27.977Z
---

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

- Builder source-size evidence or line-count output shows src/modules/autonomy/report/render.test.ts no longer triggers the 300-line advisory, focused autonomy report rendering and owner-intervention tests pass, and pnpm run typecheck plus pnpm run validate-tasks pass.
