---
id: task-handle-autonomy-report-source-size-warnings
title: Handle autonomy report source-size warnings
status: done
priority: p3
area: autonomy
summary: The post-completion corrective follow-up metric build completed, but its source-size review reported fresh advisories for src/modules/autonomy/report/aggregate.ts and src/modules/autonomy/report/render.test.ts. Split focused report aggregation/rendering helpers or tests so future autonomy report changes stay reviewable without changing behavior.
created_at: 2026-06-24T01:30:15.326Z
updated_at: 2026-06-24T02:13:35.131Z
---

## Problem

The post-completion corrective follow-up metric build completed, but its source-size review reported fresh advisories for src/modules/autonomy/report/aggregate.ts and src/modules/autonomy/report/render.test.ts. Split focused report aggregation/rendering helpers or tests so future autonomy report changes stay reviewable without changing behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T00-49-37-660Z-progress-reviewer-01rrir.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T00-49-37-660Z-progress-reviewer-01rrir.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Platform 0, Safety 2, Meta 8, Unclassified 10. Recent autonomy/security work is progressing and existing review-scrutiny/security follow-ups are queued, but the latest post-completion metric build left fresh source-size advisories in autonomy report files that are not represented by an open task.

Evidence ids:

- event:evtj-000000096152
- git:commit:cc385240bf1f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Builder source-file-size evidence or line-count output shows src/modules/autonomy/report/aggregate.ts and src/modules/autonomy/report/render.test.ts no longer trigger the cited advisory after focused post-completion follow-up/report tests pass.

## Completion Evidence

- Run artifact `.kota/runs/2026-06-24T02-00-49-645Z-builder-8s8j6z/source-size-evidence.txt` records `aggregate.ts` at 154 lines, `render.test.ts` at 290 lines, all split report helper files below the 300-line guideline, focused report tests passing, and `pnpm run typecheck` passing.
