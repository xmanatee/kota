---
id: task-resolve-workflow-runtime-source-size-advisories
title: Resolve workflow runtime source-size advisories
status: done
priority: p3
area: architecture
summary: Builder run 2026-06-28T16-33-23-932Z-builder-hooa3m completed the guarded parallel-dispatch task but left source-size advisories for src/core/workflow/runtime-runs-control.ts and src/core/workflow/runtime.ts. Split cohesive runtime helpers or record a narrow justified exception with evidence; the current ready source-size task covers different files.
created_at: 2026-06-28T17:14:39.764Z
updated_at: 2026-06-28T18:22:19.000Z
---

## Problem

Builder run 2026-06-28T16-33-23-932Z-builder-hooa3m completed the guarded parallel-dispatch task but left source-size advisories for src/core/workflow/runtime-runs-control.ts and src/core/workflow/runtime.ts. Split cohesive runtime helpers or record a narrow justified exception with evidence; the current ready source-size task covers different files.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T17-10-41-959Z-progress-reviewer-duvrnn.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T17-10-41-959Z-progress-reviewer-duvrnn.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 3, Meta 0, Unclassified 5. The monitored workflows succeeded and inspected fan-out, calibration, and security artifacts were quiet, but the latest builder run left new source-size advisories for two workflow runtime files not covered by the existing ready source-size task.

Evidence ids:

- run:2026-06-28T16-33-23-932Z-builder-hooa3m
- git:commit:ad10edb553c7
- task:task-resolve-current-source-size-advisories-from-progre

## Initiative

Outcome-aware autonomy progress review.

## Result

Resolved by splitting cohesive runtime helpers instead of declaring an exception:

- `src/core/workflow/runtime.ts` now delegates context construction to `src/core/workflow/runtime-context.ts`.
- `src/core/workflow/runtime-runs-control.ts` now delegates webhook workflow-dispatch idempotency replay/claim/complete behavior to `src/core/workflow/runtime-webhook-idempotency.ts`.
- The extraction preserves the existing webhook dispatch order: replay an existing idempotency result first, reject active same-workflow dispatches before creating new claims, then complete the claim after queue append.

## Acceptance Evidence

- Before advisory: `.kota/runs/2026-06-28T16-33-23-932Z-builder-hooa3m/source-file-size-review.json` reported `src/core/workflow/runtime-runs-control.ts` at 349 lines and `src/core/workflow/runtime.ts` at 361 lines.
- After line counts: `runtime-runs-control.ts` is 279 lines, `runtime.ts` is 185 lines, `runtime-context.ts` is 196 lines, and `runtime-webhook-idempotency.ts` is 139 lines.
- Source-size diagnostic against the staged change set returned `OK: changed source files are under source-size warning thresholds`; details are in `.kota/runs/2026-06-28T18-13-10-880Z-builder-erozow/source-size-evidence.txt`.
- Focused runtime tests passed: `pnpm exec vitest run src/core/workflow/runtime-dispatch.test.ts src/core/workflow/dead-letter-queue.test.ts src/core/workflow/runtime-lifecycle.test.ts src/core/workflow/runtime-dispatch-parallel-runs.test.ts` passed 18 tests.
- `pnpm run typecheck` and `pnpm run lint` passed.
- `pnpm run validate-tasks` passed after staging the final ready-to-done task move.
