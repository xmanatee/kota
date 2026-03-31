---
id: task-daemon-structured-logs
title: Add JSON structured logging mode to the daemon
status: ready
priority: p3
area: runtime
summary: The daemon writes plain-text log lines to stderr. Operators using log aggregators (Loki, Datadog, CloudWatch) must write brittle regex parsers to extract workflow names, run IDs, and levels. A JSON log mode would make daemon output directly ingestible.
created_at: 2026-03-31T08:31:48Z
updated_at: 2026-03-31T15:07:46Z
---

## Problem

`src/scheduler/daemon.ts` and related runtime code writes log output as unstructured text (e.g. `[kota] Workflow "foo" started run abc123`). Operators running KOTA under a process supervisor or in a container that pipes stderr to a log aggregator must parse these lines with fragile regex. There is no JSON log mode, no consistent `level` field, no `workflow` or `runId` fields that aggregators can index on.

The agent loop already has a `LOG_FORMAT` env var mechanism in `src/log-format.ts` that produces JSON for agent session output, but the daemon's own operational logs are not covered.

## Desired Outcome

- A `--log-format json` flag (or `KOTA_DAEMON_LOG_FORMAT=json` env var) switches daemon log output to newline-delimited JSON.
- Each log line becomes: `{ "ts": "<ISO8601>", "level": "info|warn|error", "msg": "...", ...fields }`.
- Key contextual fields are included where available: `workflow`, `runId`, `extension`, `event`.
- Plain text format remains the default (no breaking change for existing setups).
- Daemon startup, extension load, workflow start/finish, and error events are all covered.

## Constraints

- Reuse or extend `src/log-format.ts` conventions where possible.
- Do not thread a logger object through every call site — use a module-level logger that reads the format once at startup.
- No new npm dependencies (use built-in JSON.stringify).

## Done When

- `kota daemon start --log-format json` emits NDJSON to stderr.
- `KOTA_DAEMON_LOG_FORMAT=json kota daemon start` is equivalent.
- A unit test verifies the JSON formatter produces parseable output with expected fields.
- Existing daemon tests are unaffected.
