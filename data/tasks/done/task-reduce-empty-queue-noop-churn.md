---
id: task-reduce-empty-queue-noop-churn
title: Reduce empty-queue no-op explorer churn
status: done
priority: p2
area: autonomy
summary: Dispatcher currently wakes explorer every few minutes on an empty queue even when explorer will immediately skip; empty-queue scheduling should be quieter and more intentional.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

After the queue drains, dispatcher keeps emitting `autonomy.queue.empty` and the
runtime keeps recording short explorer workflows that only inspect and skip. This
creates noise in run history and makes it harder to tell whether autonomy is
idle by design or stuck.

## Desired Outcome

Empty-queue routing should wake explorer only when it can do useful work or when
there is a clear state transition worth recording.

## Constraints

- Keep dispatcher as the only `runtime.idle` listener.
- Prefer semantic events and simple state checks over hardcoded workflow graphs.
- Do not add budget/cost throttling as the solution.
- Keep actual useful exploration responsive when the queue becomes empty or thin.

## Done When

- Repeated empty-queue idle polls do not produce a long stream of no-op explorer
  run artifacts.
- Explorer still runs promptly when its refresh is due.
- Dispatcher output remains understandable from run metadata.
- A focused test covers the empty-queue no-op case.
