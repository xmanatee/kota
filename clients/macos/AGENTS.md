# macOS Menu Bar Client

A native SwiftUI `MenuBarExtra` app (macOS 13+) that surfaces KOTA daemon state in the system menu bar.

- All state comes from the daemon HTTP+JSON API. No direct `.kota/` file access.
- Polls `GET /status`, `GET /approvals`, `GET /tasks`, `GET /sessions`, and `GET /workflow/runs?limit=10` every 5 seconds. Uses `POST /approvals/:id/approve`, `POST /approvals/:id/reject`, `POST /workflow/trigger`, `POST /sessions` (create), `POST /sessions/:id/chat` (SSE stream), and `DELETE /sessions/:id`.
- Authentication reads `Authorization: Bearer <token>` from `.kota/daemon-control.json` in the configured project directory (local mode) or from the macOS Keychain (remote mode).
- Remote mode: operators can configure a daemon URL and auth token in Settings → Remote Daemon. When a remote URL is set it takes precedence over local project-directory discovery. The token is stored in Keychain under service `com.kota.menubar`; the URL is stored in UserDefaults under `remoteDaemonURL`.
- The status header shows a "Remote" badge when remote mode is active.
- If the daemon is unreachable, the icon shows a slash and all data is cleared — no crash, no stale state.
- Do not add Swift Package dependencies without a strong reason. The app is intentionally minimal.

## Key Files

- `KotaMenuBarApp.swift` — `@main` entry point; initializes `AppState` and attaches the `MenuBarExtra`.
- `AppState.swift` — `ObservableObject` that holds daemon status, active runs, pending approvals, task queue, sessions, and drives the poll loop. Owns local/remote connection mode: `remoteURL` (UserDefaults) and Keychain-backed token helpers (`saveRemoteConfig`, `clearRemoteConfig`, `loadRemoteToken`). Also owns `createSession()` and `endSession(_:)` for chat lifecycle.
- `DaemonClient.swift` — typed HTTP client for the daemon control API; reads `daemon-control.json` for local mode or accepts a direct URL+token via `setRemoteConnection(url:token:)`. Sets `Authorization: Bearer` header. Includes `streamChat(sessionId:message:onEvent:)` for SSE streaming via `URLSession.bytes(for:)`.
- `Models.swift` — `Decodable` types mirroring the daemon API response shapes, including `CreateSessionResponse`.
- `MenuBarView.swift` — top-level menu bar popover; delegates to section views. Also contains embedded reusable components: `StatusHeaderView`, `ActiveRunRow` (expandable run row with inline step detail), `RunDetailInlineView` (inline loading + error + content shell), `RunDetailContent` (step list + current step), `RecentRunsView` (collapsible completed-run history, collapsed by default), `RecentRunRow` (single completed run row with expandable step detail reusing `RunDetailInlineView`), `TaskQueueView` (collapsible queue summary), `MenuActionButton`.
- `ApprovalsView.swift` — list of pending approvals with approve/reject buttons.
- `SessionsView.swift` — list of active interactive sessions with a "+" button to create new sessions; tapping a row opens `ChatView` as a sheet.
- `ChatView.swift` — chat sheet for a daemon session; displays conversation history, streams SSE responses in real time, and allows ending the session. Contains `ChatMessage` model, `MessageBubble` component.
- `TriggerWorkflowView.swift` — small form for triggering a workflow by name.
