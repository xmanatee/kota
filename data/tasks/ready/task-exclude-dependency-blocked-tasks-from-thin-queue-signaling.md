---
id: task-exclude-dependency-blocked-tasks-from-thin-queue-signaling
title: Exclude dependency-blocked tasks from thin-queue signaling
status: ready
priority: p2
area: autonomy
summary: Make thin-queue detection count only dependency-clear ready/backlog work so dependency-waiting tails emit empty or waiting signals without also waking thin-queue exploration.
created_at: 2026-05-18T09:57:32Z
updated_at: 2026-05-18T09:57:32Z
---

## Problem

The dispatcher can emit both `autonomy.queue.empty` and
`autonomy.queue.thin` for the same repository state. In this run the queue had
two backlog tasks, but both declared unfinished `depends_on` predecessors, so
`pullableCount` was zero and `actionableCount` was zero. `queue.empty` was true
from the builder/promoter point of view, while `isThinPullQueue` still treated
the raw two-task backlog tail as thin because it counts `ready + backlog`
without subtracting dependency-waiting tasks.

That weakens the event vocabulary: `thin` should mean KOTA still has a small
dependency-clear work tail to top up, not that every remaining backlog item is
waiting on a blocked predecessor. Dependency-waiting tails should stay visible
through `dependencyBlockedTasks` and the empty/waiting routing paths without
also looking like promotable or nearly promotable work.

## Desired Outcome

Thin-queue signaling reflects dependency-clear pullable work. A queue whose
only ready/backlog tasks are waiting on unfinished dependencies emits
`autonomy.queue.empty` or another existing waiting signal, but not
`autonomy.queue.thin`. A queue with one or two dependency-clear ready/backlog
tasks still emits `autonomy.queue.thin` so explorer can keep reserves healthy.

## Constraints

- Keep dispatcher as the only `runtime.idle` listener.
- Do not broaden `autonomy.queue.available`; builder must still run only on
  actionable ready/doing work.
- Preserve `dependencyBlockedTasks` in dispatcher payloads so operators and
  workflows can see why the queue is not pullable.
- Do not add a new queue event unless an existing event cannot express the
  state honestly.
- Keep the logic in the repo-task/autonomy workflow surfaces that already own
  queue snapshots and dispatcher routing.

## Done When

- `isThinPullQueue` or its caller excludes dependency-waiting ready/backlog
  tasks from the thin-tail count.
- Dispatcher tests prove a dependency-blocked backlog tail with
  `pullableCount: 0` emits `autonomy.queue.empty` but not
  `autonomy.queue.thin`.
- Existing tests still prove one or two dependency-clear ready/backlog tasks
  emit `autonomy.queue.thin`.
- Dispatcher payloads still include `dependencyBlockedTasks` for the waiting
  queue shape.
- Any workflow or local `AGENTS.md` wording that defines thin vs empty queue
  semantics is updated if the code contract changes.

## Source / Intent

Explorer run `2026-05-18T09-54-12-744Z-explorer-xa96jw` received
`autonomy.queue.thin` even though `inspect-queue` reported
`pullableCount: 0`, `actionableCount: 0`, and both backlog tasks waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`.

The strategic blocked alternatives were all operator-capture gated and not
movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Local inspection found:

- `src/modules/autonomy/workflows/dispatcher/workflow.ts` emits
  `autonomy.queue.empty` when `pullableCount === 0`, then independently emits
  `autonomy.queue.thin` when `isThinPullQueue(queue)` is true.
- `src/modules/repo-tasks/repo-tasks-domain.ts` computes
  `isThinPullQueue` from raw `ready + backlog` counts and does not subtract
  dependency-waiting tasks, even though the same snapshot already exposes
  `dependencyBlockedTasks`, `pullableCount`, and `actionableCount`.
- The task scaffold command was attempted first:

```sh
pnpm kota task create "Exclude dependency-blocked tasks from thin-queue signaling" --state ready --area autonomy --priority p2 --summary "Make thin-queue detection count only dependency-clear ready/backlog work so dependency-waiting tails emit empty or waiting signals without also waking thin-queue exploration."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

## Initiative

Queue event clarity: workflow routing events should describe the actionable
shape of the queue, not raw file counts that hide dependency waits.

## Acceptance Evidence

- Focused repo-task tests for `isThinPullQueue` covering dependency-clear and
  dependency-waiting tails.
- Focused dispatcher workflow tests covering the no-`thin` dependency-blocked
  backlog case.
- `pnpm run validate-tasks`.
