---
id: task-live-run-follow-cli
title: Add kota workflow follow command for live run output streaming
status: ready
priority: p2
area: cli
summary: Operators have no way to tail the output of an actively running workflow step from the CLI. kota workflow show only works on completed runs. Adding kota workflow follow <run-id> would stream live agent output so operators can monitor autonomous runs without log diving.
created_at: 2026-03-27T23:26:32Z
updated_at: 2026-03-29T22:05:39Z
---

## Problem

`kota workflow show <run-id>` displays artifacts for a completed run. There is
no CLI command to stream output from an active run in real-time.

Operators monitoring autonomous builder, explorer, or improver runs must either
watch raw `.kota/runs/` files with `tail -f`, check Telegram alerts after the
fact, or poll `kota workflow list` for status changes. None of these give
continuous output during an active step.

The HTTP session server already has streaming endpoints for run logs. The daemon
SSE event stream (task-add-daemon-sse-event-stream) will add workflow-level
events. The missing piece is a CLI surface that wires these together into a
`follow` UX.

## Desired Outcome

`kota workflow follow` (with no run ID) attaches to the current active run.
`kota workflow follow <run-id>` streams output for a specific run, blocking
until the run completes.

Output includes: step started/completed events from the daemon SSE stream,
agent text output streamed from the HTTP session log endpoint, and a final
summary (status, duration, cost) when the run finishes.

## Constraints

- The daemon SSE event stream is complete; use `DaemonControlClient.events()`
  for workflow-level events and fall back to the existing file-polling path when
  the daemon is not running.
- Do not add new persistence or a new streaming protocol — use the daemon SSE
  event stream for workflow events and existing `.kota/runs/` artifacts for
  agent output.
- Interruptible with Ctrl-C; interrupt should not abort the run, only detach
  the follower.
- Follow the existing `workflow-cli/` pattern and register as a subcommand of
  `kota workflow`.

## Done When

- `kota workflow follow` attaches to the current active run and streams output.
- `kota workflow follow <run-id>` works for a specific run.
- Ctrl-C detaches without aborting the run.
- The command appears in `kota workflow --help`.
- When no daemon is running or no run is active, a clear message is printed.
