---
id: task-split-oversized-event-journal-source-surface
title: Split oversized event journal source surface
status: ready
priority: p3
area: core
summary: The retention-aware evidence build passed, but its source-size review still reports src/core/events/event-journal.ts at 782 lines after a touched 32-line change. Split cohesive event-journal pruning/query helpers or record a narrow typed exception without changing event retention behavior.
created_at: 2026-06-22T20:58:22.540Z
updated_at: 2026-06-22T20:58:22.540Z
---

## Problem

The retention-aware evidence build passed, but its source-size review still reports src/core/events/event-journal.ts at 782 lines after a touched 32-line change. Split cohesive event-journal pruning/query helpers or record a narrow typed exception without changing event retention behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T17-00-00-002Z-progress-reviewer-gz18op.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T17-00-00-002Z-progress-reviewer-gz18op.

review verdict: needs-steering
review summary: Global review with one directory scope needs one p3 maintainability follow-up. Balance: Product 0, Safety 2, Platform 1, Meta 1, Unclassified 16. The retention-policy work landed with critic/calibration evidence and monitor checks are healthy, but the latest builder left an untracked source-size advisory on src/core/events/event-journal.ts.

Evidence ids:

- scope:8nrg1m:artifact:2026-06-22T19-18-31-743Z-builder-cu9ttm:source-file-size-review.json
- scope:8nrg1m:artifact:2026-06-22T19-18-31-743Z-builder-cu9ttm:run-summary.json
- scope:8nrg1m:git:commit:cc78cb8ffeaf

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts show src/core/events/event-journal.ts no longer triggers the source-size guideline, or a narrow justified exception is recorded. Focused event-journal pruned-reference tests, progress-review evidence retention tests, pnpm run typecheck, pnpm run lint, and pnpm run validate-tasks pass.
