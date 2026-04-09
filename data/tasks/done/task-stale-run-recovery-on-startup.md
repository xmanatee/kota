---
id: task-stale-run-recovery-on-startup
title: Mark stale running workflow runs as interrupted on daemon startup
status: done
priority: p2
area: runtime
summary: When the daemon stops mid-run (crash or intentional), workflow runs remain stuck in "running" state permanently. On startup, the daemon should reconcile these runs to "interrupted" so operators have accurate queue state and can retry them.
created_at: 2026-04-09T02:03:33Z
updated_at: 2026-04-09T02:03:33Z
---

## Problem

Workflow runs that were actively executing when the daemon stopped (whether by crash or
`kota daemon stop`) remain in `"running"` state indefinitely. The run store has no
mechanism to detect that the executor is no longer running. After a daemon restart:

- The web UI shows phantom "running" runs that will never complete.
- `GET /status` includes these ghost runs in `workflow.activeRuns`.
- The autonomous loop may see misleading in-progress state when scheduling new work.
- Operators cannot distinguish a genuinely stuck run from one that died with the daemon.

## Desired Outcome

On daemon startup, before workflows begin dispatching, scan the run store for runs in
`"running"` state and transition them to `"interrupted"` with a `reason` field explaining
the daemon restart. The interrupted runs are then visible in the web UI and CLI run
history as `"interrupted"` — distinguishable from `"failed"` — and can be retried manually.

The startup reconciliation should:
- Only transition runs whose `startedAt` predates the current daemon startup (not runs
  legitimately started in the same boot cycle).
- Emit a `workflow.interrupted.alert` event for each reconciled run so operators are
  notified if notification channels are configured.
- Log a summary at daemon startup: "N runs marked interrupted from previous session."

## Constraints

- Reconciliation runs once at startup before the dispatch loop begins — no polling.
- Does not automatically retry interrupted runs; that is an explicit operator action.
- `"interrupted"` is already a valid run status in the existing type system; no schema change required.
- Works correctly when the daemon restarts with zero stale runs (no-op path).

## Done When

- Daemon startup reconciles stale `"running"` runs to `"interrupted"` status.
- The web UI and CLI `kota workflow history` show these runs as `"interrupted"` with a reason.
- `workflow.interrupted.alert` event is emitted for each reconciled run.
- Startup summary is logged.
- Unit test covers: stale runs reconciled on startup; fresh run (same boot) not touched; zero-stale no-op.
