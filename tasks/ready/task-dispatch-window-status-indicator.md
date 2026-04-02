---
id: task-dispatch-window-status-indicator
title: Show dispatch window blocked state in kota workflow status and web UI
status: ready
priority: p3
area: operator-ux
summary: When scheduler.dispatchWindow is configured and the current time is outside the allowed window, neither kota workflow status nor the web UI indicates that dispatch is blocked. Operators who set business-hours dispatch and wonder why no runs start at night have no feedback.
created_at: 2026-04-02T07:30:00Z
updated_at: 2026-04-02T07:30:00Z
---

## Problem

`scheduler.dispatchWindow` (shipped recently) restricts `runtime.idle` and `intervalMs`
triggers to a configured time-of-day and day-of-week window. When the scheduler is outside
the window, it silently defers dispatch — but `kota workflow status` only shows
`Dispatch: PAUSED` for the explicit pause flag, and the web UI does the same. An operator
who configured a business-hours window and finds no autonomous runs at night has no
in-system explanation for why.

`WorkflowLiveStatus` has no `dispatchWindowBlocked` field. `printWorkflowStatus` in
`control.ts` has no branch for window state. The web UI status section has no indicator.

## Desired Outcome

- `WorkflowLiveStatus` gains optional `dispatchWindowBlocked?: boolean` and
  `dispatchWindowOpensAt?: string` (ISO timestamp of next window open, when blocked).
- `getWorkflowLiveStatus()` in `src/workflow/runtime.ts` populates these fields when
  `scheduler.dispatchWindow` is configured and the window is currently closed (using the
  existing `isWithinDispatchWindow` and `msUntilDispatchWindowOpens` helpers).
- `kota workflow status` prints a line like:
  `Dispatch: blocked by window (opens Mon 09:00)` when blocked, and
  `Dispatch: window open` (or nothing extra) when within the window.
- The web UI workflow status section shows the same indicator next to the pause badge
  when the window is blocking dispatch.

## Constraints

- Only emit the window fields when `scheduler.dispatchWindow` is present in config.
  When no window is configured, the fields are absent and nothing changes in the output.
- No change to runtime dispatch logic — this is purely observability.
- The `dispatchWindowOpensAt` value should be human-readable in CLI output; ISO format
  for the API field.
- Do not add a separate daemon API endpoint; the existing `WorkflowLiveStatus` shape is
  sufficient.

## Done When

- `WorkflowLiveStatus` type includes the two new optional fields.
- `getWorkflowLiveStatus` returns them when the window is configured and currently closed.
- `kota workflow status` prints the blocked-by-window line when appropriate.
- Web UI shows the indicator in the status panel.
- Unit test covers `getWorkflowLiveStatus` returning the correct fields inside and outside
  a configured window.
