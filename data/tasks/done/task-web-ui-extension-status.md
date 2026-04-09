---
id: task-web-ui-module-status
title: Add module status panel to the web UI dashboard
status: done
priority: p3
area: operator-ux
summary: Modules are the sole integration unit in KOTA but their load state and health are only visible via the CLI. The web dashboard has no panel showing which modules are loaded, what tools/agents they contribute, or whether any failed to load.
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T04:39:00Z
---

## Problem

`kota module list` and `kota module inspect <name>` expose module metadata
via CLI, but the web dashboard has no equivalent surface. An operator watching the
dashboard cannot tell whether all expected modules loaded, which tools are available,
or if an module crashed on startup — without switching to the terminal.

There is no existing `/api/modules` endpoint on the server; adding one is part of
this task.

## Desired Outcome

An "Modules" panel in the web UI dashboard that:
- Lists loaded modules with name, version, and contribution summary (tool count,
  agent count, workflow count).
- Shows load status (loaded / failed) and an error summary if an module failed.
- Follows the same panel component pattern as other panels (static on load; no SSE
  needed unless module hot-reload is implemented first).

No module control (enable/disable) is required — read-only display is enough.

## Constraints

- Add a `GET /api/modules` server route that returns module metadata from the
  loaded module registry.
- Use the existing panel component pattern from approvals, tasks, and sessions panels.
- No changes to module loading or lifecycle code beyond exposing existing state.
- If daemon config hot-reload (`task-daemon-config-hot-reload`) ships first, the panel
  should update on reload via SSE; otherwise static load is acceptable.

## Done When

- `GET /api/modules` returns name, version, status, and contribution counts for
  each loaded module.
- Modules panel renders in the web UI using this endpoint.
- Panel shows correct empty/error state.
- Existing web UI tests pass; new behavior covered by at least one test.
