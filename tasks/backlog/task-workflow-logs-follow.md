---
id: task-workflow-logs-follow
title: Add --follow flag to kota workflow logs for live run monitoring
status: backlog
priority: p3
area: workflow-cli
summary: >
  `kota workflow logs` reads completed run events, but operators cannot watch
  an active run in progress. Since the daemon already appends agent messages
  incrementally to `steps/*.events.jsonl`, a `--follow` mode is feasible without
  runtime changes.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`kota workflow logs <run-id>` works only after a run completes. During a long
autonomous build or improver run, operators have no way to observe agent
activity in real time without digging into raw files under `.kota/runs/`.

## Desired Outcome

- `kota workflow logs --follow` (or `-f`) streams agent output for the currently
  active run, polling the active step's `.events.jsonl` file and printing new
  lines as they arrive.
- If no run is active, the command waits and begins streaming when one starts.
- Ctrl-C exits cleanly.
- `kota workflow logs <run-id> --follow` can also tail a specific run by ID
  (useful if the run is already complete — behaves like normal output then exits).

## Constraints

- Follow mode should poll the events file; no daemon IPC or file-watcher
  infrastructure needed. Poll interval of ~500 ms is sufficient.
- Active run ID can be determined from `WorkflowRuntimeState` in
  `workflow-state.json` (`activeRunId` field).
- Reuse `formatAgentMessage` and related utilities from `workflow-logs.ts`.
- No changes to `WorkflowRunStore` or runtime required.

## Done When

- `kota workflow logs --follow` streams the active run's agent output in real time.
- Tests cover the polling loop and clean exit on completion.
