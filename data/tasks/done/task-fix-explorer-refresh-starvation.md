---
id: task-fix-explorer-refresh-starvation
title: Fix explorer refresh starvation on empty queues
status: done
priority: p1
area: autonomy
summary: Explorer no-op runs update the workflow lastCompletedAt timestamp, so the 30-minute exploration refresh never becomes due while dispatcher keeps enqueueing skipped explorer runs.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

When the queue is empty, dispatcher emits `autonomy.queue.empty` repeatedly.
Explorer runs its inspect step, skips the agent step when `explorationRefreshDue`
is false, and still completes the workflow. That completion updates
`workflows.explorer.lastCompletedAt`, so the refresh window is continually reset.

The result is a starved explorer: the daemon looks healthy, but no substantive
external exploration happens after the queue drains.

## Desired Outcome

Explorer should measure the refresh interval from the last substantive
exploration, not from skipped/no-op workflow completions.

## Constraints

- Keep the mechanism simple and explicit.
- Do not add another routing surface or workflow registry.
- Do not rely on prompt instructions to fix this; the runtime logic should make
  the correct behavior natural.
- Preserve cheap skipped runs only if they do not reset the substantive
  exploration clock.

## Done When

- An empty queue can trigger a real explorer agent run after the configured
  refresh interval even if skipped explorer workflows ran in between.
- Skipped explorer runs no longer postpone the next real exploration.
- The behavior is covered by a focused workflow or runtime test.
- Existing explorer queue-thin behavior still works.
