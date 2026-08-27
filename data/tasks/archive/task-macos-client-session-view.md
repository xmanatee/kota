---
status: done
---

# Add active sessions panel to macOS menu bar client

## Problem

The macOS menu bar client polls `/status`, `/approvals`, and `/tasks` but does not call `GET /sessions`. When a user has `kota serve` running in a terminal, the menu bar gives no indication that an interactive session is active. Operators must check the terminal directly to know if a session is in progress.

## Desired Outcome

A `SessionsView.swift` panel in the macOS client shows the currently active sessions returned by `GET /sessions`. Each row displays: session ID (truncated), start time, and the model in use. The section header shows the active session count. The panel renders alongside the existing Approvals and Tasks sections in `MenuBarView.swift`.

`AppState.swift` polls `GET /sessions` on the same 5-second cadence as the other endpoints. `DaemonClient.swift` gains a `fetchSessions()` method. `Models.swift` gains a `SessionSummary` decodable struct matching the daemon API response shape.

## Constraints

- No new daemon API endpoints required; `GET /sessions` already exists.
- Keep the view minimal: count + list of sessions, no detailed log streaming.
- Match the existing SwiftUI style used by `ApprovalsView.swift` and `TriggerWorkflowView.swift`.
- No new Swift package dependencies.

## Done When

- `SessionsView.swift` renders active sessions in the menu bar popover.
- `AppState` polls `/sessions` and the session count appears in the section header.
- The panel gracefully shows "No active sessions" when the list is empty.
- The macOS client `AGENTS.md` is updated to mention `SessionsView.swift`.
