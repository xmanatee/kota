# macOS Menu Bar Client

A native SwiftUI `MenuBarExtra` app (macOS 13+) that surfaces KOTA daemon state in the system menu bar.

- All state comes from the daemon HTTP+JSON API. No direct `.kota/` file access.
- Polls `GET /status`, `GET /approvals`, `GET /tasks`, `GET /sessions`, and `GET /workflow/runs?limit=10` every 5 seconds. Uses `POST /approvals/:id/approve`, `POST /approvals/:id/reject`, `POST /workflow/trigger`, `POST /sessions` (create), `POST /sessions/:id/chat` (SSE stream), and `DELETE /sessions/:id`.
- Authentication reads `Authorization: Bearer <token>` from `.kota/daemon-control.json` in the configured project directory (local mode) or from the macOS Keychain (remote mode).
- Remote mode: operators can configure a daemon URL and auth token in Settings → Remote Daemon. When a remote URL is set it takes precedence over local project-directory discovery. The token is stored in Keychain under service `com.kota.menubar`; the URL is stored in UserDefaults under `remoteDaemonURL`.
- The status header shows a "Remote" badge when remote mode is active.
- If the daemon is unreachable, the icon shows a slash and all data is cleared — no crash, no stale state.
- Do not add Swift Package dependencies without a strong reason. The app is intentionally minimal.

