---
id: task-json-log-format
title: Add structured JSON log format for production log aggregation
status: done
priority: p3
area: runtime
summary: The current log output is human-readable text suitable for development but not for production deployments that aggregate logs with tools like Datadog, Loki, or ELK. A configurable JSON log format would let operators pipe KOTA logs into standard observability stacks without custom parsers.
created_at: 2026-03-31T04:39:00Z
updated_at: 2026-03-31T04:39:00Z
---

## Problem

KOTA's logger (defined in `src/module-context.ts`) emits plain-text lines to
stdout/stderr. In production deployments, log lines are typically ingested by a
log aggregator that expects structured JSON (`{"level":"info","msg":"...","ts":...}`).
Plain-text lines must be parsed with fragile regex rules or are dropped, losing
context like workflow run IDs, module names, and step labels.

There is no `LOG_FORMAT` or equivalent config option today.

## Desired Outcome

When `LOG_FORMAT=json` is set (or `log.format: "json"` in config), every log line
emitted through the KOTA logger is a single JSON object with at minimum:
- `level` — one of `debug`, `info`, `warn`, `error`
- `msg` — the log message string
- `ts` — ISO 8601 timestamp
- Any structured fields passed by the caller (e.g. `workflowId`, `runId`, `module`)

Human-readable format remains the default when `LOG_FORMAT` is absent or `"text"`.

No new npm dependencies required; implement with plain `JSON.stringify`.

## Constraints

- Change is confined to the logger layer; callers must not need to change.
- The format switch must be detectable at startup, not per-call.
- No performance-sensitive hot paths should do format detection on every log call;
  resolve the formatter once at init time and store a reference.
- Existing log-related tests must continue to pass.
- Document the new env var in `docs/` (or the relevant config reference).

## Done When

- `LOG_FORMAT=json` produces newline-delimited JSON log output.
- Default (no env var) continues to produce human-readable text.
- At least one test verifies the JSON output structure.
- Behavior documented in config or operations docs.
