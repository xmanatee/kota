# Clients

This directory contains native client apps that connect to the KOTA daemon control API.

- Each client lives in its own subdirectory (e.g. `macos/`, `ios/`, `mobile/`).
- Clients are thin: all live state comes from the daemon HTTP+JSON API and SSE
  event stream. No client parses `.kota/` files or starts its own KOTA runtime.
- Authentication and daemon discovery must go through the client wrapper for
  that platform, not ad hoc view code.
- Clients are not modules. They do not contribute tools, workflows, channels, or agents.
- Native platform technology is preferred (SwiftUI for macOS/iOS, Kotlin/Jetpack Compose for Android, or a cross-platform framework when targeting multiple platforms).

## Clients

- `web/` — browser dashboard served by the daemon.
- `macos/` — native menu bar client.
- `mobile/` — mobile client.

## Adding a New Client

- Create a subdirectory with an `AGENTS.md` that states ownership boundaries and
  durable platform conventions.
- Build against the daemon control API source and client wrapper types.
- Do not require any daemon or server changes — the existing API should be sufficient.
- If you discover a missing API capability, add a task to `data/inbox/` rather than patching the daemon from within the client.
