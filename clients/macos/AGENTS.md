# macOS Menu Bar Client

A native SwiftUI `MenuBarExtra` app (macOS 13+) that surfaces KOTA daemon state in the system menu bar.

- All state comes from the daemon HTTP+JSON API. No direct `.kota/` file access.
- Polls `GET /status`, `GET /approvals`, `GET /tasks`, `GET /sessions`, and `GET /workflow/runs?limit=10` every 5 seconds. Uses `POST /approvals/:id/approve`, `POST /approvals/:id/reject`, and `POST /workflow/trigger`.
- Authentication reads `Authorization: Bearer <token>` from `.kota/daemon-control.json` in the configured project directory.
- If the daemon is unreachable, the icon shows a slash and all data is cleared — no crash, no stale state.
- Do not add Swift Package dependencies without a strong reason. The app is intentionally minimal.

## Key Files

- `KotaMenuBarApp.swift` — `@main` entry point; initializes `AppState` and attaches the `MenuBarExtra`.
- `AppState.swift` — `ObservableObject` that holds daemon status, active runs, pending approvals, task queue, and drives the poll loop.
- `DaemonClient.swift` — typed HTTP client for the daemon control API; reads `daemon-control.json`, sets `Authorization` header.
- `Models.swift` — `Decodable` types mirroring the daemon API response shapes.
- `MenuBarView.swift` — top-level menu bar popover; delegates to section views. Also contains embedded reusable components: `StatusHeaderView`, `ActiveRunRow` (expandable run row with inline step detail), `RunDetailInlineView` (inline loading + error + content shell), `RunDetailContent` (step list + current step), `RecentRunsView` (collapsible completed-run history, collapsed by default), `RecentRunRow` (single completed run row with expandable step detail reusing `RunDetailInlineView`), `TaskQueueView` (collapsible queue summary), `MenuActionButton`.
- `ApprovalsView.swift` — list of pending approvals with approve/reject buttons.
- `SessionsView.swift` — list of active interactive sessions from `GET /sessions`, with session ID and elapsed time.
- `TriggerWorkflowView.swift` — small form for triggering a workflow by name.
