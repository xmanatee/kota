---
id: task-event-bus-query-cli
title: Add CLI command to query recent daemon bus events for trigger debugging
status: done
priority: p2
area: modules
summary: The daemon EventRingBuffer holds recent bus events but there is no CLI command to query them. Operators debugging workflow trigger mismatches must watch SSE streams in real time. A query command with type and time filters would close this gap.
created_at: 2026-04-12T09:30:00Z
updated_at: 2026-04-12T10:14:07.450Z
---

## Problem

When a workflow does not trigger as expected, operators have no retrospective
view of what events the daemon emitted. The `EventRingBuffer` in
`src/core/daemon/event-ring-buffer.ts` stores up to 500 recent events in
memory, and the SSE endpoint streams events as they happen, but there is no
command-line interface to query buffered events after the fact.

Debugging trigger mismatches currently requires watching the SSE stream in a
separate terminal, reproducing the condition, and manually correlating event
types with workflow trigger definitions. This is slow and error-prone.

## Desired Outcome

A CLI command (e.g. `kota daemon events` or `kota workflow events`) queries the
daemon's event ring buffer and prints matching events with timestamps, types,
and payload summaries.

Supported filters:
- `--type <pattern>` — filter by event type (glob or prefix match).
- `--since <duration>` — only events within the last N minutes/hours.
- `--limit <n>` — cap output (default 50).
- `--json` — raw JSON output for scripting.

## Constraints

- The command talks to the daemon control API. If the daemon is not running, it
  should fail with a clear message.
- Add a control API endpoint (e.g. `GET /events`) that exposes the ring buffer
  with query parameters, and have the CLI command call it.
- Keep the ring buffer in-memory only — do not add persistent event storage.
- Place the CLI command in `workflow-ops` or `daemon-ops`, whichever is the
  better fit for event introspection.

## Done When

- A daemon control API endpoint returns filtered events from the ring buffer.
- A CLI command queries the endpoint and prints formatted output.
- `--type`, `--since`, `--limit`, and `--json` flags work.
- Tests cover the API endpoint with type and time filters.
