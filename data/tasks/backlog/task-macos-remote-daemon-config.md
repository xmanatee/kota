---
id: task-macos-remote-daemon-config
title: Support remote daemon connection in macOS menu bar client
status: backlog
priority: p2
area: client
summary: The macOS menu bar client discovers the daemon via a local project directory socket. Operators running KOTA on a remote machine cannot point the macOS client at that daemon. Add explicit URL + auth token configuration in Settings to enable remote connections.
created_at: 2026-04-10T08:00:00Z
updated_at: 2026-04-10T08:00:00Z
---

## Problem

`AppState.swift` constructs the daemon connection by reading a local project directory (selected via `promptForProjectDirectory()`), which only works when the daemon runs on the same machine. Operators who run the KOTA daemon on a remote server, NAS, or cloud VM have no way to connect the macOS menu bar client to it.

The `DaemonClient.swift` already accepts a `baseURL` and `token`, so the client transport layer supports remote connections — the gap is only in configuration and Settings UI.

## Desired Outcome

The macOS Settings window gains an optional "Remote Daemon" section with:
- A URL field (`http://host:port` form)
- An auth token field (stored in Keychain, not UserDefaults)

When a remote URL is configured, it takes precedence over local project-directory discovery. The connection mode is shown clearly in the menu bar or status header so the operator knows which daemon is active.

## Constraints

- Local auto-discovery (project directory socket) must continue to work unchanged as the default.
- Auth tokens must be stored in the macOS Keychain, not plaintext in UserDefaults.
- Do not add daemon network connectivity — the existing HTTP API is sufficient.
- The Settings UI should remain simple: remote config is an override, not a replacement for local mode.

## Done When

- Operators can enter a remote daemon URL and token in Settings.
- The client connects to the remote daemon and displays the same status, runs, sessions, and approvals it would show for a local daemon.
- Token is persisted securely in Keychain across restarts.
- The Swift build passes cleanly.
