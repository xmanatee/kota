# Clients

This directory contains native client apps that connect to the KOTA daemon control API.

- Each client lives in its own subdirectory (e.g. `macos/`, `ios/`, `mobile/`).
- Clients are thin: all live state comes from the daemon HTTP+JSON API (`GET /status`, `GET /approvals`, etc.) and SSE event stream (`GET /events`). No client parses `.kota/` files or starts its own KOTA runtime.
- Authentication uses `Authorization: Bearer <token>` with the token read from `.kota/daemon-control.json`.
- Clients are not modules. They do not contribute tools, workflows, channels, or agents.
- Native platform technology is preferred (SwiftUI for macOS/iOS, Kotlin/Jetpack Compose for Android, or a cross-platform framework when targeting multiple platforms).

## Clients

- `macos/` — SwiftUI `MenuBarExtra` app (macOS 13+). Surfaces daemon health, active workflow runs with inline step detail, approval management, and workflow triggering. Polls the daemon API every 5 seconds.
- `mobile/` — React Native (Expo) app (iOS 16+, Android 12+). Four-tab interface: Status, Runs, Approvals, Tasks. SSE-driven live updates with polling fallback. Token stored in OS secure keychain.

## Adding a New Client

- Create a subdirectory with a `README.md` and an `AGENTS.md`.
- Build against the daemon control API documented in `docs/DAEMON-API.md`.
- Do not require any daemon or server changes — the existing API should be sufficient.
- If you discover a missing API capability, add a task to `data/inbox/` rather than patching the daemon from within the client.
