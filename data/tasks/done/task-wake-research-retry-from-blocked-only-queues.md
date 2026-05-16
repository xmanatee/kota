---
id: task-wake-research-retry-from-blocked-only-queues
title: Wake research-retry from blocked-only queues
status: done
priority: p2
area: autonomy
summary: Research-retry can starve when only blocked research candidates remain because it listens only to actionable queue availability.
created_at: 2026-05-16T04:02:46.000Z
updated_at: 2026-05-16T04:13:51.880Z
---

## Problem

`research-retry` was added so blocked research tasks with `## Resources`
can move forward once rendered-browser or authenticated-browser capability is
available. The workflow currently triggers on `autonomy.queue.available`,
which dispatcher emits only when `ready/` or `doing/` contains actionable
work.

In a blocked-only queue, dispatcher emits `autonomy.queue.empty` and never
emits `autonomy.queue.available`. That is the queue shape in this run: no
ready/backlog/doing tasks, several blocked research tasks, and the only
strategic alternatives require operator-capture artifacts. If the operator
provisions browser capability while the queue is otherwise empty, the retry
workflow has no semantic wake-up path and the blocked research tasks can sit
idle until unrelated actionable work appears.

## Desired Outcome

Blocked research retry should wake from a queue state that actually describes
its input: attemptable blocked research candidates. A blocked-only queue with
an attemptable candidate should be able to run `research-retry` without
inventing unrelated ready work, while a blocked-only queue with no candidates,
missing capability, or unchanged retry fingerprints should stay cheap and
quiet.

## Constraints

- Do not broaden `autonomy.queue.available`; builder must continue to gate
  only on actionable `ready/` + `doing/` work.
- Prefer a semantic event or typed precondition that describes research-retry
  availability over a workflow-name special case.
- Preserve the skip contract from
  `task-stop-research-retry-re-confirmation-churn-when-cap`: missing
  Playwright/auth profile or unchanged resource fingerprints must skip without
  invoking the agent or committing.
- Keep source-access honesty intact. A wake-up path is not permission to mark
  unread or auth-walled sources done.
- Avoid a core capability registry or parallel queue. The logic should stay
  in the autonomy/repo-task workflow surfaces that already own this behavior.

## Done When

- A blocked-only queue with at least one attemptable `research-retry`
  candidate can wake the workflow and run the existing candidate inspection
  path.
- A blocked-only queue with no attemptable candidate does not invoke the
  research-retry agent and does not produce no-signal commits.
- Dispatcher / workflow tests cover the starvation shape: `ready=0`,
  `doing=0`, `backlog=0`, blocked research candidate present, and no
  `autonomy.queue.available` event.
- Existing builder routing tests still prove builder only consumes
  `autonomy.queue.available`.
- `src/modules/autonomy/workflows/research-retry/AGENTS.md` and any
  dispatcher/workflow-local guidance are updated to name the new wake-up
  contract without duplicating code details.

## Source / Intent

Explorer run `2026-05-16T04-00-43-752Z-explorer-hfuh17` observed an empty
actionable queue (`ready=0`, `doing=0`, `backlog=0`) with only blocked tasks.
The exposed strategic blocked alternatives all had `operator-capture`
preconditions and were not movable. Code inspection showed
`src/modules/autonomy/workflows/research-retry/workflow.ts` listens only to
`autonomy.queue.available`, while
`src/modules/autonomy/workflows/dispatcher/workflow.ts` emits
`autonomy.queue.empty` for blocked-only queues.

## Initiative

Recoverable research access: KOTA should progress blocked research as soon as
the required browser capability exists, without depending on unrelated queue
work to wake the retry workflow.

## Acceptance Evidence

- Focused workflow or dispatcher tests demonstrating the blocked-only wake-up
  path and the no-candidate/no-capability skip path.
- `pnpm run validate-tasks`.
- A targeted autonomy workflow test command covering the new routing behavior.
