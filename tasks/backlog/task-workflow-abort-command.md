---
id: task-workflow-abort-command
title: Add kota workflow abort command to cancel active run
status: backlog
priority: p2
area: workflow-cli
summary: The daemon's active run can only be cancelled by stopping the daemon entirely. A dedicated `kota workflow abort` command should abort the current run via the existing abort controller without stopping the daemon or losing the queue.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowRuntime` already holds an `activeAbortController` that is triggered on `stop()`. There is no operator-accessible path to abort just the in-progress run. The only current option — `kota daemon stop` — also kills the scheduler, loses the pending queue, and requires a manual restart. During a misbehaving or runaway agent step, operators have no targeted intervention.

## Desired Outcome

- `kota workflow abort` writes a signal file to `.kota/` (e.g. `abort-request`) that the runtime detects on its next dispatch/idle cycle and calls `activeAbortController.abort()`.
- The active run is marked `interrupted` and the run record is persisted normally.
- The daemon and scheduler remain running; pending queued runs are preserved.
- `kota workflow status` reflects the abort in progress while it is pending.

## Constraints

- Follow the same file-based signal pattern proposed for pause/resume (`task-workflow-pause-resume-cli`).
- Do not add out-of-process IPC or signals beyond what the file-polling pattern already provides.
- Abort is best-effort: the agent step may not terminate immediately (depends on SDK cancellation support).
- The signal file must be cleaned up after the abort is processed to avoid phantom aborts on the next run.

## Done When

- `kota workflow abort` causes the active run to terminate and be recorded as `interrupted`.
- The daemon continues running and picks up the next queued run normally.
- Tests verify the abort signal is detected and the run state is updated.
