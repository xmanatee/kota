---
status: done
---

# Split oversized event journal source surface

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

## Resolution

Split the event journal into focused core event helpers for types, envelope construction, payload redaction/storage, query predicates, projections, and codec validation. `src/core/events/event-journal.ts` is now the journal facade and is 154 lines; the extracted helper files are each below 300 lines.

## Acceptance Evidence

- Before: cited source-size review reported `src/core/events/event-journal.ts` at 782 lines.
- After: `wc -l` reports `src/core/events/event-journal.ts` at 154 lines, with extracted helpers at 248 lines or less.
- `checkSevereSourceFileSize(process.cwd())` on the staged diff returned `OK: changed source files are under source-size warning thresholds`.
- Focused event-journal pruned-reference tests passed: `pnpm test src/core/events/event-journal.test.ts src/core/events/event-journal-pruned-reference.test.ts`.
- Progress-review retention tests passed: `pnpm test src/modules/autonomy/workflows/progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts src/modules/autonomy/workflows/progress-reviewer/progress-review/pruned-run-evidence.test.ts`.
- `pnpm run typecheck` and `pnpm run lint` passed on the final source content; `pnpm run validate-tasks` passed after staging the final task move.
