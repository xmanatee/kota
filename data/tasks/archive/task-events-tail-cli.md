---
status: done
---

# Add kota events tail command to stream the daemon event bus

## Problem

The daemon event ring buffer (`GET /api/events` on the daemon control port, proxied via `/api/daemon/events`) provides a live SSE stream of all internal bus events. The web UI already consumes this stream for live dashboard updates, but there is no CLI command to observe it. Operators debugging workflow behavior or module integrations have no direct way to watch the event flow from a terminal.

## Desired Outcome

A `kota events tail` command that:
- Connects to the daemon's `/api/daemon/events` SSE stream via `DaemonControlClient`
- Prints events to stdout in a human-readable format: `<timestamp> <event-type> <summary>`
- Supports `--json` flag to emit raw NDJSON for piping to `jq` or other tools
- Supports `--filter <type-prefix>` to narrow output (e.g. `--filter workflow` shows only workflow.* events)
- Exits cleanly on Ctrl-C
- Prints a clear error if the daemon is not running

## Constraints

- Register the command in a new `events-cli.ts` alongside existing CLI files; register it in `cli.ts`.
- Use `DaemonControlClient.events()` from `src/server/daemon-client.ts` (same as `follow.ts` and `server-routes.ts`).
- Follow the output style of `kota workflow run follow` for consistency.
- No new dependencies.

## Done When

- `kota events tail` streams live daemon events to stdout.
- `--json` flag outputs NDJSON.
- `--filter` flag narrows by event type prefix.
- Command appears in `kota --help` output.
- Type-checking and linting pass.
