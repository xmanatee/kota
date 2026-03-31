---
id: task-workflow-definitions-api
title: Expose loaded workflow definitions via daemon control API
status: backlog
priority: p3
area: runtime
summary: The daemon control API exposes workflow run state and history but not the loaded workflow definitions themselves. Thin clients (web UI, mobile apps) cannot show trigger types, cron expressions, step counts, or enabled state without reading config files directly.
created_at: 2026-03-31T00:36:00Z
updated_at: 2026-03-31T00:36:00Z
---

## Problem

`kota workflow definitions` reads workflow definitions from source files and prints
them to the terminal. Thin clients — the web UI dashboard, a hypothetical mobile app,
or any consumer of the daemon control API — have no equivalent surface. They can see
run history and live runtime state (via `/workflow/status`) but cannot determine:

- Which workflows are enabled/disabled.
- What trigger type each workflow uses (event, cron, interval, webhook).
- What the cron expression or interval duration is.
- How many steps each workflow has.

This gap means the Schedules panel in the web UI must either read config files directly
(violating the client/daemon split) or show incomplete information.

## Desired Outcome

A `GET /workflow/definitions` endpoint on the daemon control API that returns a list of
loaded workflow definitions with the following fields per definition:

```json
{
  "name": "builder",
  "enabled": true,
  "stepCount": 5,
  "triggers": [
    { "type": "event", "event": "runtime.idle" },
    { "type": "cron", "schedule": "0 * * * *" },
    { "type": "interval", "intervalMs": 3600000 },
    { "type": "webhook" }
  ]
}
```

The endpoint requires `read` scope (same as `/workflow/status`). It is read-only; no
mutation is exposed.

## Constraints

- Access definitions via the `WorkflowRuntime` handle already held by
  `DaemonControlServer`; do not add a new state path.
- The runtime must expose a `getDefinitions()` method (or equivalent) that returns the
  currently loaded `WorkflowDefinition[]`.
- Endpoint is documented in `docs/DAEMON-API.md`.
- No changes to definition loading or validation logic.

## Done When

- `GET /workflow/definitions` returns the list described above.
- The endpoint is accessible via `DaemonControlClient` (add a typed method).
- `docs/DAEMON-API.md` documents the endpoint and response shape.
- At least one test covers the new route.
