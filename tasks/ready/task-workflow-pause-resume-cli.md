---
id: task-workflow-pause-resume-cli
title: Add kota workflow pause/resume commands for operator control
status: ready
priority: p3
area: workflow-cli
summary: The workflow runtime supports pausing dispatch via `setDispatchPaused`, but there is no CLI command for operators to pause and resume the workflow queue without stopping the daemon. Add `kota workflow pause` and `kota workflow resume`.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowRuntime.setDispatchPaused(true)` exists and is used internally during daemon restarts, but it is not exposed to operators. During maintenance windows or when debugging a bad workflow, operators need to stop new runs from dispatching without killing the daemon. Today the only option is `kota daemon stop`.

## Desired Outcome

- `kota workflow pause` — signals the running daemon to pause dispatching new runs; the currently active run (if any) completes normally
- `kota workflow resume` — signals the daemon to resume dispatching
- `kota workflow status` output indicates whether dispatch is currently paused

## Constraints

- Pause/resume state should survive daemon restarts; persist a `dispatchPaused` field in `DaemonState` (see `src/scheduler/daemon-state.ts`) and write it to `daemon-state.json` on change
- There is no out-of-process IPC. Follow the file-based pattern used by `ApprovalQueue` (`src/approval-queue.ts`): the CLI writes a signal file to `.kota/`, the daemon polls or reads it on each dispatch cycle
- Do not expose or change `setDispatchPaused` directly; the CLI signal should flow through the daemon's state file so it works regardless of whether the daemon is running

## Done When

- `kota workflow pause` stops new runs from starting
- `kota workflow resume` re-enables dispatch
- `kota workflow status` reflects pause state
- Tests verify the pause/resume state transitions
