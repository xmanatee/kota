---
status: done
---

# Expose foreign module restart counts and health state in the web UI Modules panel

## Problem

`loadForeignModules` manages subprocess lifecycle with automatic restart and
exponential backoff. When a foreign module crashes and restarts, this is
only logged to stderr. There is no structured health state visible to operators.

The web UI Modules panel (via `GET /api/modules`) shows module name
and description but nothing about KEMP subprocess health: restart count,
last-restart time, or whether the module is currently failing.

Operators who configure a foreign module and then see silent agent failures
have no diagnostic signal in the dashboard.

## Desired Outcome

1. The foreign module loader tracks health state per module: restart
   count, last restart time, and current status (`ok`, `restarting`, `dead`).
2. `GET /api/modules` (or `GET /status`) includes health state for foreign
   modules.
3. The web UI Modules panel renders a health badge (green/yellow/red) next
   to each foreign module, with restart count and last-restart time on hover
   or in an expanded row.

## Constraints

- Health state is in-memory only; it does not need to persist across daemon
  restarts.
- Do not change the KEMP protocol or `KotaModule` interface in ways that
  break existing modules.
- The existing `GET /api/modules` route may be extended, or a new
  `GET /api/modules/:name/health` endpoint added — choose the simpler path.
- Non-foreign (built-in) modules have no subprocess health; render them
  as always healthy or omit the badge.

## Done When

- Daemon tracks restart count and last-restart timestamp for each foreign
  module subprocess.
- `GET /api/modules` response includes `health` field for foreign
  modules (`{ status, restartCount, lastRestartAt }`).
- Web UI Modules panel shows a color-coded health badge for foreign
  modules.
- A unit test covers the health state tracking logic in the loader.
