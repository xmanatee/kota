---
id: task-extension-cli-health-status
title: Show foreign extension health status in kota extension inspect
status: backlog
priority: p3
area: cli
summary: The web UI already shows foreign extension health (restartCount, lastRestartAt, status) but kota extension inspect does not. Operators using KEMP extensions have no CLI visibility into whether a subprocess has been crashing and restarting.
created_at: 2026-04-01T11:42:09Z
updated_at: 2026-04-01T11:42:09Z
---

## Problem

Foreign (KEMP) extensions auto-restart on crash with exponential backoff, and their health
state is tracked in `ExtensionHealth` (restartCount, lastRestartAt, status: ok/restarting/dead).
The web UI Extensions panel already surfaces this information (task done), and the server route
`GET /api/extensions` passes `health` through to the response.

However, `kota extension inspect <name>` does not display health status. An operator
troubleshooting a misbehaving foreign extension from a terminal sees tools, workflows, and
channels — but no indication that the extension has restarted 12 times or is currently in
a dead state.

## Desired Outcome

`kota extension inspect <name>` shows a Health section when `ExtensionSummary.health` is
present:

```
Health:    ok  (0 restarts)
```

or if degraded:

```
Health:    restarting  (3 restarts, last: 2026-04-01T11:32:00Z)
```

or:

```
Health:    dead  (5 restarts, last: 2026-04-01T11:35:00Z)
```

The `--json` flag already outputs the full `ExtensionSummary` including `health`, so no
JSON change is needed — only the human-readable display path.

## Constraints

- Only display the Health section when `ext.health` is present (non-foreign extensions
  will have it undefined).
- Use the existing `health` field on `ExtensionSummary`; do not add new API calls.
- `kota extension list` does not need to change; health detail belongs in inspect.
- No new dependencies.

## Done When

- `kota extension inspect <name>` prints a Health line when `ext.health` is defined.
- Status, restart count, and last restart timestamp are shown when non-zero.
- Type-checking and linting pass.
