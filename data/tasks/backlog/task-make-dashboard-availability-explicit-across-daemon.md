---
id: task-make-dashboard-availability-explicit-across-daemon
title: Make dashboard availability explicit across daemon and clients
status: backlog
priority: p2
area: client
summary: Replace hardcoded dashboard URLs and blind Open Dashboard actions with daemon-reported web UI availability and exact URL handling across macOS, mobile, web shells, and CLI/operator clients.
created_at: 2026-04-28T22:36:05.792Z
updated_at: 2026-04-28T22:36:05.792Z
---

## Problem

The macOS app's `webUIURL` falls back to `http://localhost:3000`, while daemon
static routes return `{ error: "Web UI not installed" }` when no built web UI is
configured. This makes "Open Dashboard" look broken even when the daemon is
working correctly.

The deeper issue is cross-client: dashboard/web UI availability is not a
first-class daemon capability, so clients guess host/port semantics.

## Desired Outcome

Dashboard availability is explicit across daemon and clients:

- daemon status/capability contract reports whether a dashboard/web UI is
  installed/served and its exact URL when available;
- clients disable or explain "Open Dashboard" when unavailable;
- clients open the correct daemon-served URL or configured external dashboard;
- docs clarify the difference between daemon control API, web dashboard, and
  development server.

## Constraints

- Do not start a web server from thin clients.
- Do not hardcode `localhost:3000` as the production fallback.
- Preserve developer workflow for the web dev server where it is intentionally
  configured.
- Coordinate with shared thin-client contract and provider readiness tasks if
  they provide the right response shape.
- Cover macOS and at least one non-macOS client/CLI status surface.

## Done When

- Daemon exposes dashboard availability and URL in a typed way.
- macOS "Open Dashboard" no longer blindly opens `localhost:3000`.
- At least one other client or CLI status surface reflects dashboard
  availability consistently.
- Tests cover installed/available, not-installed, and configured external URL
  cases.
- Rendered evidence shows the unavailable state is clear and not presented as a
  broken click.

## Source / Intent

Owner feedback on 2026-04-28: "Open Dashboard" opens localhost:3000 but nothing
is hosted there. Code references: macOS fallback in
`clients/macos/Sources/KotaMenuBar/AppState.swift`; daemon fallback in
`src/modules/web/static-routes.ts`; web UI directory set only through web start
logic in `src/modules/web/web-operations.ts`.

## Initiative

Client capability truthfulness: clients should only offer actions the daemon can
actually satisfy, or explain why not.

## Acceptance Evidence

- Tests for dashboard availability response and client behavior.
- Screenshot/rendered artifact of macOS dashboard unavailable/available states.
- CLI or non-macOS transcript showing the same availability semantics.
