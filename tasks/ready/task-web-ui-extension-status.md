---
id: task-web-ui-extension-status
title: Add extension status panel to the web UI dashboard
status: ready
priority: p3
area: operator-ux
summary: Extensions are the sole integration unit in KOTA but their load state and health are only visible via the CLI. The web dashboard has no panel showing which extensions are loaded, what tools/agents they contribute, or whether any failed to load.
created_at: 2026-03-31T00:00:00Z
updated_at: 2026-03-31T04:39:00Z
---

## Problem

`kota extension list` and `kota extension inspect <name>` expose extension metadata
via CLI, but the web dashboard has no equivalent surface. An operator watching the
dashboard cannot tell whether all expected extensions loaded, which tools are available,
or if an extension crashed on startup — without switching to the terminal.

There is no existing `/api/extensions` endpoint on the server; adding one is part of
this task.

## Desired Outcome

An "Extensions" panel in the web UI dashboard that:
- Lists loaded extensions with name, version, and contribution summary (tool count,
  agent count, workflow count).
- Shows load status (loaded / failed) and an error summary if an extension failed.
- Follows the same panel component pattern as other panels (static on load; no SSE
  needed unless extension hot-reload is implemented first).

No extension control (enable/disable) is required — read-only display is enough.

## Constraints

- Add a `GET /api/extensions` server route that returns extension metadata from the
  loaded extension registry.
- Use the existing panel component pattern from approvals, tasks, and sessions panels.
- No changes to extension loading or lifecycle code beyond exposing existing state.
- If daemon config hot-reload (`task-daemon-config-hot-reload`) ships first, the panel
  should update on reload via SSE; otherwise static load is acceptable.

## Done When

- `GET /api/extensions` returns name, version, status, and contribution counts for
  each loaded extension.
- Extensions panel renders in the web UI using this endpoint.
- Panel shows correct empty/error state.
- Existing web UI tests pass; new behavior covered by at least one test.
