---
id: task-workflow-definition-reload
title: Reload workflow definitions without daemon restart
status: backlog
priority: p3
area: workflow
summary: Workflow definitions are loaded once at daemon startup. Changing a built-in workflow or adding a new one requires restarting the daemon. A `kota workflow reload` command (or SIGHUP handler) should re-validate and re-apply definitions in the running runtime.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowRuntime.loadDefinitions()` is called once during `start()`. Any change to a workflow definition — enabling/disabling it, updating trigger schedules, adding a new step — requires a full daemon restart. This interrupts any actively running workflow and loses the in-memory schedule state.

## Desired Outcome

- `kota workflow reload` signals the running daemon to reload definitions.
- The runtime re-validates and re-applies definitions without stopping the daemon.
- Active runs are not interrupted; the new definitions take effect after the current run completes.
- Schedule timers are reconciled: new triggers are registered, removed triggers are cancelled.
- `kota workflow status` indicates when definitions were last loaded.

## Constraints

- Use the existing event bus or daemon IPC mechanism — do not introduce a new signal channel.
- Re-validation errors must be surfaced clearly (logged and returned in the CLI response); a bad definition must not crash the runtime.
- Do not touch in-flight runs: only pending scheduling and future dispatches are affected.

## Done When

- `kota workflow reload` causes the runtime to re-read and re-apply workflow definitions.
- Schedule timers are updated to match the new definition set.
- Bad definitions produce a clear error without crashing the daemon.
- Tests verify reload reconciles triggers and preserves in-flight runs.
