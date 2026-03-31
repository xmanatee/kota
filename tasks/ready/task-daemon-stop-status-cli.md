---
id: task-daemon-stop-status-cli
title: Add kota daemon stop and kota daemon status subcommands
status: ready
priority: p2
area: cli
summary: kota daemon only starts the daemon. There is no kota daemon stop to send SIGTERM, no kota daemon status to check health, and no kota daemon pid to find the running process. Operators managing the daemon from scripts or shell must write their own wrappers.
created_at: 2026-03-31T00:36:00Z
updated_at: 2026-03-31T01:15:00Z
---

## Problem

`kota daemon` starts the daemon but provides no control subcommands:

- `kota daemon stop` — no way to gracefully stop a running daemon via CLI (operators
  must kill the process manually).
- `kota daemon status` — no quick health check; operators must use `curl` or open the
  web UI to see if the daemon is alive.
- `kota daemon pid` — no way to retrieve the PID of the running daemon process.

This gap makes it difficult to integrate KOTA's daemon lifecycle into scripts,
`systemd` units, or `launchd` plists that need clean start/stop/status semantics.

## Desired Outcome

Three new subcommands under `kota daemon`:

- `kota daemon stop` — discovers the running daemon's control API socket, sends
  `SIGTERM` (or a `POST /shutdown` control endpoint if one exists), and waits up to a
  timeout for the process to exit. Exits 0 on clean stop, non-zero if not running or
  timed out.
- `kota daemon status` — calls `GET /status` on the daemon control API and prints a
  brief summary (running: yes/no, active runs, pending runs, connected sessions, uptime
  if available). Exits 0 if the daemon is reachable, non-zero if not.
- `kota daemon pid` — prints the PID of the running daemon process, or exits non-zero
  if not running.

## Constraints

- Subcommands live in the daemon extension (`src/extensions/daemon.ts`) alongside the
  existing `daemon` start command.
- Use `DaemonControlClient` for the status call; check whether a stop endpoint or
  signal mechanism exists before adding one.
- If a `POST /shutdown` endpoint does not exist on the daemon control API, add it
  (requires a PID file or IPC mechanism to send SIGTERM to the daemon child process).
- `kota daemon reload` is a separate task (`task-daemon-config-hot-reload`) — do not
  implement it here.
- No changes to daemon startup behavior.

## Done When

- `kota daemon stop` gracefully stops a running daemon and exits 0 on success.
- `kota daemon status` prints daemon health summary and exits 0 if reachable.
- `kota daemon pid` prints the process ID of the running daemon.
- All three commands exit non-zero with a clear message when no daemon is running.
- `kota daemon --help` lists all three subcommands.
