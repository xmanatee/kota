# Clients

This directory contains native client apps that connect to the KOTA daemon control API.

- Each client lives in its own subdirectory (e.g. `macos/`, `ios/`, `mobile/`).
- Clients are thin: all live state comes from the daemon HTTP+JSON API (`GET /status`, `GET /approvals`, etc.) and SSE event stream (`GET /events`). No client parses `.kota/` files or starts its own KOTA runtime.
- Authentication uses `Authorization: Bearer <token>` with the token read from `.kota/daemon-control.json`.
- Clients are not extensions. They do not contribute tools, workflows, channels, or agents.
- Native platform technology is preferred (SwiftUI for macOS/iOS, Kotlin/Jetpack Compose for Android, or a cross-platform framework when targeting multiple platforms).

## Clients

- `macos/` — SwiftUI `MenuBarExtra` app (macOS 13+). Shows daemon health icon, active workflow runs, pending approvals with approve/reject, and a trigger-workflow dialog. Polls the daemon API every 5 seconds.

## Adding a New Client

- Create a subdirectory with a `README.md` and an `AGENTS.md`.
- Build against the daemon control API documented in `docs/DAEMON-API.md`.
- Do not require any daemon or server changes — the existing API should be sufficient.
- If you discover a missing API capability, add a task to `tasks/inbox/` rather than patching the daemon from within the client.
