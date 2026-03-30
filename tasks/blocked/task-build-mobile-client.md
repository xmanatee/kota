---
id: task-build-mobile-client
title: Build a mobile client for the KOTA daemon
status: blocked
priority: p2
area: client
summary: Build a mobile client (iOS and/or Android) that connects to the KOTA daemon control API and lets operators inspect and control their autonomous development system from their phone.
created_at: 2026-03-30T16:19:34Z
updated_at: 2026-03-30T18:50:00Z
blocked_reason: Requires building a full native mobile app (React Native or SwiftUI). Too large to complete in a single builder run without a dedicated design pass. Needs UI/UX design, auth flow, navigation structure, and full API integration before implementation can begin productively.
---

## Problem

The KOTA daemon exposes a complete HTTP+JSON control API (`DaemonControlServer`)
with SSE streaming (`GET /events`), full workflow and session state, approval
management, task queue, and history. The architecture explicitly identifies
mobile clients as a target, but no mobile client exists.

Operators currently need a laptop to monitor running workflows, review failures,
or approve pending tool calls. On a phone, there is no way to know if the
autonomous loop is stuck, spending too much, or waiting for approval.

## Desired Outcome

A mobile client (iOS-first, Android optional) that:
- Discovers and connects to a running daemon (local network or configured URL)
- Reads live daemon status: active workflow runs, queue depth, last failure
- Lists and resolves pending approvals
- Views recent run history with step detail
- Subscribes to SSE events for push-like live updates without polling

The client must be thin — it reads from and writes to the daemon API only.
It must not parse `.kota/` files directly or reimplement runtime logic.

## Constraints

- Use native mobile technology (SwiftUI for iOS, or a cross-platform framework
  like React Native if targeting both platforms).
- All live state must come from the daemon control API — no `.kota/` file access.
- Token-based auth must be used for daemon connections (`X-Kota-Token` header).
- The client should be a thin wrapper over the existing daemon API with no
  server-side additions required beyond what already exists.
- Treat this as a standalone app, not an extension — mobile clients are not
  extension contributors.

## Done When

- The app can authenticate to a running daemon and display live workflow status.
- Pending approvals are visible and can be approved or rejected from the app.
- Recent run history with status and duration is viewable.
- SSE event stream is used for live updates (not polling every N seconds).
- The app does not parse `.kota/` files directly for any live state.
