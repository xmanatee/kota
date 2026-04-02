---
id: task-web-ui-workflow-enable-disable
title: Add enable/disable toggle to workflow definitions panel in web UI
status: done
priority: p3
area: web-ui
summary: The workflow definitions panel shows (disabled) for disabled workflows but has no toggle button. The daemon API already exposes POST /workflow/definitions/:name/enable and /disable — exposing them in the UI would let operators control individual workflows from the browser without CLI access.
created_at: 2026-04-02T06:47:00Z
updated_at: 2026-04-02T07:00:00Z
---

## Problem

The web UI definitions panel (added via `task-web-ui-all-workflows-panel`) renders
a `(disabled)` badge next to disabled workflow names but provides no way to toggle the
enabled state. The only way to enable or disable a workflow at runtime is via
`kota workflow enable <name>` / `kota workflow disable <name>` CLI commands.

The daemon control API has had `POST /workflow/definitions/:name/enable` and
`POST /workflow/definitions/:name/disable` since `task-workflow-enable-disable-api`.
The endpoints are documented in `docs/DAEMON-API.md` and proxied through the HTTP
server at `/api/workflow/definitions/:name/enable` and `/disable`.

## Desired Outcome

Each workflow row in the definitions panel gains an **Enable** / **Disable** toggle
button (label switches based on current `enabled` state, accounting for
`runtimeEnabled` override when present). Clicking it calls the appropriate endpoint
and refreshes the definitions list.

The button follows the same visual pattern as the existing "▶ Run" trigger button
(`wf-ctrl-btn` class) and is placed beside it in the row.

## Constraints

- No backend changes — both endpoints already exist.
- Use the same `apiPost` fetch pattern as the existing trigger and pause/resume buttons.
- If the call fails, show a brief inline error consistent with how other workflow
  control failures are shown.
- A runtime `runtimeEnabled` override takes precedence over the static `enabled`
  field for determining the displayed toggle state.

## Done When

- Each definition row shows an Enable or Disable button based on current enabled state.
- Clicking the button calls the correct `/api/workflow/definitions/:name/enable` or
  `/disable` endpoint and refreshes the panel.
- The button is disabled during the request to prevent double-submission.
- Manual verification: disabling a workflow in the UI prevents it from appearing as
  eligible to trigger, and enabling it restores it.
