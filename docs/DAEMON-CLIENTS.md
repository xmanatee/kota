# Daemon And Clients

KOTA should have one long-lived runtime host and many possible clients.

## Goal

Support all of these cleanly without parallel runtimes or ad hoc file scraping:

- `kota daemon` for autonomous work
- daemon-aware CLI commands
- a native macOS menu bar app
- a dedicated web app
- a mobile app

The daemon should be the source of truth. Clients should talk to it through one
control API.

## Core Shape

- The `daemon` owns workflows, sessions, channels, stores, extension runtime,
  and live operational state.
- A `client` connects to the daemon to inspect, control, or participate in
  sessions.
- A `channel` is a daemon-owned transport that maps incoming/outgoing traffic to
  sessions.
- `session` stays core and transport-agnostic.

This keeps one runtime and one live state owner.

## Modes

### Standalone CLI

`kota run` can still create a local one-shot or interactive session without a
daemon. This is the direct local mode.

### Daemon Mode

`kota daemon` runs the long-lived runtime. When it is running, it owns:

- workflow execution
- live session registry
- channel routing
- operator status and control surfaces

### Client Mode

CLI, native desktop apps, web apps, and mobile apps should be able to connect
to the daemon as clients instead of starting their own KOTA runtimes.

## Control API

The first-class daemon protocol should be:

- HTTP + JSON for commands and snapshots
- SSE for live status, run events, and streamed agent output

Why this shape:

- it already matches KOTA's existing server/API direction
- it is universal across CLI, browser, Swift, and mobile clients
- it is simpler and more legible than introducing separate WebSocket, XPC, and
  file-based control planes at once

WebSocket can still be added later if a specific client truly needs it, but it
should not become a second source of truth or a separate control protocol.

## Source Of Truth

When the daemon is running:

- clients should not parse `.kota/` files to infer live state
- clients should not probe PIDs or stitch together state from run artifacts
- live session, workflow, and status information should come from the daemon
  API

Run artifacts and stores remain durable evidence and persistence, not the live
control boundary.

## Channels vs Clients

This distinction matters:

- a `client` is an app or shell that talks to the daemon API
- a `channel` is a daemon-owned transport that routes conversational traffic
  into sessions

Examples:

- native macOS menu bar app = client
- daemon-aware CLI = client
- web dashboard = client
- mobile app = client
- Telegram bot = channel
- daemon-backed web chat transport = channel

A web app may include both roles: operator screens as a client, and chat routes
as a channel hosted by the daemon.

## Native macOS App

The macOS app should be a thin native client, not the daemon itself.

- use SwiftUI `MenuBarExtra` / AppKit menu bar primitives for the UI
- optionally use `SMAppService` for login-item / helper registration
- talk to the daemon over the same control API used by other clients

Do not make Apple-only IPC such as XPC the primary daemon protocol. XPC is a
reasonable app-internal mechanism on macOS, but KOTA needs one protocol that
also works for CLI, web, and mobile clients.

## Web And Mobile

Web and mobile should not require their own KOTA runtimes. They should attach
to the daemon over the same control API and event streams.

That means:

- one authentication model
- one live status/event model
- one session control model
- one workflow control model

## Migration Direction

1. ✓ Formalize the daemon API and its ownership boundaries.
2. ✓ Move live status/control off file scraping and onto the daemon API.
3. ✓ Split CLI into standalone mode and daemon-client mode.
4. ✓ Make the web/server surface daemon-backed instead of a parallel runtime.
5. Add thin native/web/mobile clients on top of the same protocol.

## External Anchors

- Apple menu bar and background-service guidance:
  - https://developer.apple.com/documentation/swiftui/menubarextra
  - https://developer.apple.com/documentation/servicemanagement/smappservice/agent%28plistname%3A%29
  - https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/DesigningDaemons.html
- OpenClaw gateway/session model:
  - https://docs.openclaw.ai/cli/gateway
  - https://docs.openclaw.ai/session
