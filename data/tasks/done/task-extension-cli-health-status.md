---
id: task-module-cli-health-status
title: Show foreign module health status in kota module inspect
status: done
priority: p3
area: cli
summary: The web UI already shows foreign module health (restartCount, lastRestartAt, status) but kota module inspect does not. Operators using KEMP modules have no CLI visibility into whether a subprocess has been crashing and restarting.
created_at: 2026-04-01T11:42:09Z
updated_at: 2026-04-01T18:44:59Z
---

## Problem

Foreign (KEMP) modules auto-restart on crash with exponential backoff, and their health
state is tracked in `ModuleHealth` (restartCount, lastRestartAt, status: ok/restarting/dead).
The web UI Modules panel already surfaces this information (task done), and the server route
`GET /api/modules` passes `health` through to the response.

However, `kota module inspect <name>` does not display health status. An operator
troubleshooting a misbehaving foreign module from a terminal sees tools, workflows, and
channels — but no indication that the module has restarted 12 times or is currently in
a dead state.

## Desired Outcome

`kota module inspect <name>` shows a Health section when `ModuleSummary.health` is
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

The `--json` flag already outputs the full `ModuleSummary` including `health`, so no
JSON change is needed — only the human-readable display path.

## Constraints

- Only display the Health section when `ext.health` is present (non-foreign modules
  will have it undefined).
- Use the existing `health` field on `ModuleSummary`; do not add new API calls.
- `kota module list` does not need to change; health detail belongs in inspect.
- No new dependencies.

## Done When

- `kota module inspect <name>` prints a Health line when `ext.health` is defined.
- Status, restart count, and last restart timestamp are shown when non-zero.
- Type-checking and linting pass.
