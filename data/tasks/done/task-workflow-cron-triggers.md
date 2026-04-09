---
id: task-workflow-cron-triggers
title: Support cron-based workflow triggers
status: done
priority: p2
area: workflow
summary: All workflow triggers are event-based. There is no way to trigger a workflow on a time-based schedule (e.g. "every day at midnight"). Adding a cron trigger type would let workflows run on fixed schedules without relying on the idle event and its cooldown heuristics.
created_at: 2026-03-20
updated_at: 2026-03-20T02:33:00Z
---

## Problem

The only time-based trigger today is `runtime.idle`, which fires every 30 seconds and is gated by a per-workflow cooldown. It works for "run occasionally" but not for "run at a specific time" or "run every N hours regardless of other activity". Scheduled cleanup, pruning, and daily summary workflows can't be expressed cleanly.

The `Scheduler` module already handles cron-like repeating schedules and emits events. It isn't connected to the workflow trigger system.

## Desired Outcome

A `WorkflowTriggerInput` can specify a cron or interval schedule that the runtime converts into timer-driven events. Workflow authors can write:

```ts
triggers: [{ event: "schedule", schedule: "0 2 * * *" }]
// or a simple interval:
triggers: [{ event: "schedule", intervalMs: 6 * 60 * 60 * 1000 }]
```

The runtime handles scheduling internally without requiring external cron jobs.

## Constraints

- Reuse or extend the existing `Scheduler` for timer management.
- The cron format should use a well-known parser already in the dependency tree or a minimal addition.
- Persisted schedule state should survive daemon restarts.
- Keep the existing event-based trigger path unchanged.

## Done When

- Workflow definitions accept a schedule-based trigger shape.
- Triggers fire at the correct times after daemon restart.
- The `kota workflow status` command shows the next scheduled run time for schedule-triggered workflows.
- Unit tests cover schedule trigger registration and firing.
