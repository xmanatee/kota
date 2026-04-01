---
id: task-foreign-extension-health-ui
title: Expose foreign extension restart counts and health state in the web UI Extensions panel
status: backlog
priority: p3
area: operator-ux
summary: Foreign (KEMP) extensions auto-restart on crash with exponential backoff, but restart history and current health state are not surfaced anywhere. The web UI Extensions panel shows only name and description, leaving operators blind to subprocess failures.
created_at: 2026-04-01T00:32:00Z
updated_at: 2026-04-01T00:32:00Z
---

## Problem

`loadForeignExtensions` manages subprocess lifecycle with automatic restart and
exponential backoff. When a foreign extension crashes and restarts, this is
only logged to stderr. There is no structured health state visible to operators.

The web UI Extensions panel (via `GET /api/extensions`) shows extension name
and description but nothing about KEMP subprocess health: restart count,
last-restart time, or whether the extension is currently failing.

Operators who configure a foreign extension and then see silent agent failures
have no diagnostic signal in the dashboard.

## Desired Outcome

1. The foreign extension loader tracks health state per extension: restart
   count, last restart time, and current status (`ok`, `restarting`, `dead`).
2. `GET /api/extensions` (or `GET /status`) includes health state for foreign
   extensions.
3. The web UI Extensions panel renders a health badge (green/yellow/red) next
   to each foreign extension, with restart count and last-restart time on hover
   or in an expanded row.

## Constraints

- Health state is in-memory only; it does not need to persist across daemon
  restarts.
- Do not change the KEMP protocol or `KotaExtension` interface in ways that
  break existing extensions.
- The existing `GET /api/extensions` route may be extended, or a new
  `GET /api/extensions/:name/health` endpoint added — choose the simpler path.
- Non-foreign (built-in) extensions have no subprocess health; render them
  as always healthy or omit the badge.

## Done When

- Daemon tracks restart count and last-restart timestamp for each foreign
  extension subprocess.
- `GET /api/extensions` response includes `health` field for foreign
  extensions (`{ status, restartCount, lastRestartAt }`).
- Web UI Extensions panel shows a color-coded health badge for foreign
  extensions.
- A unit test covers the health state tracking logic in the loader.
