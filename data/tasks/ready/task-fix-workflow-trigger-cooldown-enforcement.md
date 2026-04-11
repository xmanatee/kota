---
id: task-fix-workflow-trigger-cooldown-enforcement
title: Fix workflow trigger cooldown not preventing bounce runs
status: ready
priority: p2
area: core
summary: Trigger cooldowns on workflow definitions are not preventing runs from being picked within the cooldown window, causing repeated zero-cost bounce runs that create run directory noise.
created_at: 2026-04-11T13:00:00Z
updated_at: 2026-04-11T13:00:00Z
---

## Problem

Workflow trigger cooldowns defined via `cooldownMs` are not reliably preventing
runs from being dispatched within the cooldown window. Observable evidence from
April 11 2026:

**Explorer bounce loop (00:29–01:46 UTC):**
- Explorer trigger has `cooldownMs: 1_800_000` (30 minutes).
- 15 explorer runs fired in ~75 minutes, all triggered by `autonomy.queue.empty`.
- Every run completed in < 100ms with $0 cost (the `explore` agent step skipped
  via its `when` predicate because `explorationRefreshDue` was false).
- Expected: at most 3 runs in 75 minutes (one per 30-minute cooldown window).
- Actual: one run every ~5 minutes.

**Overall impact:**
- 85 of 130 explorer runs (65%) are zero-cost bounce runs.
- 38 of 162 improver runs are similarly zero-cost.
- Each bounce run creates a run directory with metadata, step, trigger, and
  workflow JSON files. These accumulate until the 7-day prune cycle cleans them.

**Cooldown path:**
- `enqueue()` in `workflow-queue.ts` calls `getEligibleAtMs(workflowName,
  cooldownMs, state)` from `run-executor-utils.ts`.
- `getEligibleAtMs` reads `state.workflows[workflowName]?.lastCompletedAt` and
  returns `lastCompletedAt + cooldownMs`.
- `pick()` checks `item.notBeforeMs > now` and should skip runs whose cooldown
  has not elapsed.
- State is written synchronously by `active-run-handle.ts:finish()` via
  read-modify-write on `workflow-state.json`.

Despite this path, runs are dispatched well before the cooldown expires.
Possible root cause is a state-write race in `finish()` — concurrent run
completions do read-modify-write on the same state file without locking, so a
later writer can overwrite a `lastCompletedAt` update from a concurrent
completion. Agent workflows yield the event loop on API calls, creating windows
where code-only workflow completions can interleave.

## Desired Outcome

Trigger cooldowns reliably prevent workflow dispatch within the cooldown window.
The explorer does not fire more than once per 30-minute period when the queue is
empty and no real exploration occurs.

## Constraints

- Fix must be in `src/core/workflow/` — this is core runtime behavior.
- Do not change the `cooldownMs` API or semantics.
- Do not add module-level workarounds — the core mechanism should work.
- The fix must handle concurrent run completions safely.

## Done When

- `getEligibleAtMs` consistently returns a future timestamp for a workflow that
  completed within the cooldown window, even under concurrent completions.
- The explorer bounce pattern (15 zero-cost runs in 75 minutes) does not
  reproduce.
- Existing cooldown tests in `runtime.test.ts` still pass.
- A test specifically covers the concurrent-completion state-write scenario.
