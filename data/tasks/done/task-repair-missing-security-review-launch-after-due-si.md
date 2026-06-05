---
id: task-repair-missing-security-review-launch-after-due-si
title: Repair missing security-review launch after due signal
status: done
priority: p1
area: autonomy
summary: Progress-review evidence now includes pending workflow queue entries, so a due security-review run queued behind the active agent slot is citeable instead of being misreported as a missing launch.
created_at: 2026-06-05T20:32:31.143Z
updated_at: 2026-06-05T20:45:26.000Z
---

## Problem

Investigate why dispatcher emitted a high-risk `autonomy.security-review.due` signal but no newer `security-review` run appears afterward, then fix the routing, cooldown, scope filtering, or dispatch behavior that prevented launch.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-05T20-20-53-772Z-progress-reviewer-w3ky9h.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Resolution

The cited dispatcher run 2026-06-05T20-07-46-967Z-dispatcher-syoiyn did emit `autonomy.security-review.due` with cooldown remaining at 0. The workflow trigger was already present, and a focused runtime regression now proves a due-triggered `security-review` run dispatches after the active agent slot frees.

The concrete repair is evidence visibility: progress-review evidence now folds pending workflow queue entries from `.kota/workflow-state.json` into the existing `runs` evidence array with `status: pending`. The current runtime state contains pending due-triggered run `2026-06-05T20-33-05-134Z-security-review-lmkme7`, so future progress reviews can cite the queued security-review run rather than creating another missing-launch follow-up while the agent slot is occupied.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-05T20-20-53-772Z-progress-reviewer-w3ky9h.

review verdict: needs-steering
review summary: KOTA is making useful autonomous progress, but workflow health is not fully recovered: the improver failure path was repaired, while progress-reviewer still has an open P1 repair task and a due security-review signal appears not to have launched a newer security-review run.

Evidence ids:

- run:2026-06-05T20-07-46-967Z-dispatcher-syoiyn

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-05T20-33-04-888Z-builder-vdvmmh/security-review-routing-evidence.json` records the cited due event, the current pending due-triggered `security-review` run, and verification results.
- `pnpm exec vitest run src/core/workflow/runtime-dispatch.test.ts src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts` passed: 2 files, 22 tests.
- `pnpm run typecheck` passed.
