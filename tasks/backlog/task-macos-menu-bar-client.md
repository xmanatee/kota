---
id: task-macos-menu-bar-client
title: Build a native macOS menu bar client backed by the daemon control API
status: backlog
priority: p2
area: extensions
summary: KOTA's daemon exposes a stable HTTP+JSON control API that covers all live status, workflow control, history, and approvals. A thin Swift/SwiftUI menu bar app using MenuBarExtra would give macOS operators always-available status, approval prompts, and workflow controls without opening a browser.
created_at: 2026-04-01T03:11:00Z
updated_at: 2026-04-01T03:11:00Z
---

## Problem

Operators running KOTA on macOS must open a browser tab to monitor workflow status, respond to approvals, or trigger workflows. The daemon's HTTP control API is designed for exactly this kind of thin client (see `docs/DAEMON-CLIENTS.md`), but no native client exists yet. The web UI works but lacks OS-level integration: no menu bar icon, no native notifications, no dock badge for pending approvals.

## Desired Outcome

A minimal SwiftUI `MenuBarExtra` app (macOS 13+) that:
1. Discovers the daemon via `.kota/daemon-control.json` in a configured project directory.
2. Shows a status icon in the menu bar (idle / running / error) reflecting daemon health.
3. Lists active workflow runs with name, status, and elapsed time in a popover menu.
4. Lists pending approvals with approve/reject buttons that call `POST /approvals/:id/approve` and `POST /approvals/:id/reject`.
5. Provides a "Trigger…" menu item that opens a small dialog to trigger a workflow by name.
6. Opens the web UI in the default browser via a "Open Dashboard" menu item.

The app talks exclusively to the daemon HTTP API and does not start its own KOTA runtime.

## Constraints

- Swift/SwiftUI only; no Electron, no bundled Node. Binary should be small and launch quickly.
- macOS 13+ (`MenuBarExtra` API). Can gate on availability if needed for broader OS support.
- Use `SMAppService` or a Launch Agent plist for optional login-item registration; do not use legacy `LSUIElement` alone.
- Reads token from `.kota/daemon-control.json`; sends `Authorization: Bearer <token>` on all requests.
- No daemon API changes required — use existing endpoints.
- App lives in a `clients/macos/` subdirectory of the mono repo.
- Reference: https://developer.apple.com/documentation/swiftui/menubarextra

## Done When

- The app builds and runs on macOS 13+.
- Menu bar icon reflects daemon health (green/amber/red dot).
- Active workflow runs appear in the popover with status and elapsed time.
- Pending approvals appear with approve/reject buttons that call the daemon API.
- "Open Dashboard" opens the web UI URL.
- No modifications to the KOTA daemon or server are required.
