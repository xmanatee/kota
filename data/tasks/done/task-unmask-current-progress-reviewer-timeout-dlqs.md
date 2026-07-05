---
id: task-unmask-current-progress-reviewer-timeout-dlqs
title: Unmask current progress-reviewer timeout DLQs
status: done
priority: p1
area: autonomy
task_class: Meta
summary: Three July 3 progress-reviewer review-evidence timeout DLQs remain open after the health-reviewer skipped new work for a done same-dedupe task. Fix or narrow the health-reviewer dedupe behavior so new evidence fingerprints after a completed repair still create actionable work, then reconcile the three current DLQ items with redrive or dismissal rationale.
created_at: 2026-07-05T15:02:33.720Z
updated_at: 2026-07-05T15:22:38.948Z
---

## Problem

    Three July 3 progress-reviewer review-evidence timeout DLQs remain open after the health-reviewer skipped new work for a done same-dedupe task. Fix or narrow the health-reviewer dedupe behavior so new evidence fingerprints after a completed repair still create actionable work, then reconcile the three current DLQ items with redrive or dismissal rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-05T15-00-00-010Z-progress-reviewer-130fdl.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-05T15-00-00-010Z-progress-reviewer-130fdl.

review verdict: needs-steering
review summary:

    The global review window has no task-class activity to balance: Product 0, Safety 0, Platform 0, Meta 0. Recent dispatcher and health-reviewer runs completed, but three open progress-reviewer review-evidence timeout dead letters remain, and the health-reviewer skipped new work because an older same-dedupe task is already done.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-112bbfd9-632e-460a-9a0b-4a126f4603f8
- scope:8nrg1m:dead-letter:dlq-15e44129-2278-490f-a3c4-dcf6a08c6d43
- scope:8nrg1m:dead-letter:dlq-8582e38e-3782-44d7-a1d7-db376727edfc
- scope:8nrg1m:artifact:2026-07-05T14-45-06-377Z-autonomy-health-reviewer-d4cbdl:steps/apply-actions.json

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Resolution

The health-reviewer action path now treats a terminal same-dedupe task as stale
when the current evidence fingerprint differs. The previous done task for
`dead-letter:execution:workflow-runtime:progress-reviewer` recorded fingerprint
`bf712eea3fd1821c`; the current timeout DLQ cluster records fingerprint
`efbb647e9b838769`. New evidence after the closed task now creates a
fingerprint-scoped ready task id instead of being skipped.

The three cited DLQ rows were read from the canonical runtime store and remain
open only because this sandbox cannot write
`/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`.
The reconciliation artifact records the before/current state, the failed
canonical dismissal attempt, and the durable dismissal rationale. Redrive is
not appropriate because progress-reviewer run
`2026-07-05T15-00-00-010Z-progress-reviewer-130fdl` already reached
`review-evidence` successfully and cited these same stale rows.

## Acceptance Evidence

- `src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-terminal-task.test.ts`
  covers a completed same-dedupe task with a different current evidence
  fingerprint and verifies fresh ready work is created.
- `.kota/runs/2026-07-05T15-02-40-105Z-builder-ep1v4x/dlq-reconciliation.md`
  records the three cited DLQ ids, the later same-shape progress-reviewer
  success, and the stale-redrive dismissal rationale.
- Focused validation passed:
  `pnpm test src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review.test.ts src/modules/autonomy/workflows/autonomy-health-reviewer/health-review-terminal-task.test.ts`.
  Build, typecheck, lint, and workflow validation also passed after the source
  change.
