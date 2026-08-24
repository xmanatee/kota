---
id: task-split-client-state-into-generated-transport-and-do
title: Split client state into generated transport and domain stores
status: backlog
priority: p2
area: client
task_class: Platform
depends_on: [task-generate-all-thin-client-daemon-contract-bindings]
summary: Replace oversized client application-state objects with generated wire contracts and focused scope, task, session, setup, and UI stores.
created_at: 2026-08-24T02:13:50.623Z
updated_at: 2026-08-24T03:03:20.000Z
---

## Problem

Apple `AppState`, mobile daemon/context state, and related client aggregates
mix transport decoding, connection lifecycle, scope selection, sessions,
tasks, setup, approvals, shared UI, polling, and presentation coordination.
Large state owners duplicate domain joins and make generated contracts harder
to adopt cleanly.

## Desired Outcome

After scope and contract generation land, refactor clients around generated
wire contracts plus focused domain stores for connection/readiness, scope,
sessions, tasks/workflows, setup/approvals, and shared UI. A thin application
coordinator composes those stores without becoming a second daemon model.

## Constraints

- Preserve native SwiftUI, React Native, and web presentation; only semantic
  transport/state ownership is shared through generated contracts.
- Clients never read `.kota/`, reconstruct daemon authority, or maintain a
  parallel capability inventory.
- Domain stores subscribe to daemon events through one client transport and
  expose explicit loading, ready, unavailable, and error states.
- Remove copied decoders and old aggregate-owned state as each client moves;
  no permanent forwarding properties or duplicate stores remain.
- Keep keyboard, touch, narrow-screen, light/dark, and reduced-motion behavior
  intact for operator surfaces.

## Done When

- Apple, mobile, and web use generated wire contracts and focused domain state
  owners with a small composition root.
- Scope switching invalidates and reloads only scope-owned state; daemon-global
  state remains stable.
- Reconnect, restart, stale response, cancellation, and partial capability
  readiness have deterministic tests.
- Old aggregate-owned domain logic, hand decoders, and duplicate projections
  are removed.

## Source / Intent

Owner-approved client-architecture rewrite from the 2026-08-24 audit. Static
UI review found good accessible rendering; this task preserves that quality
while cleaning transport and state ownership.

## Initiative

Thin native clients over one daemon contract.

## Acceptance Evidence

- Cross-client state/reconnect fixtures using the same generated daemon
  envelopes.
- Rendered web/mobile/Apple evidence for scope switch, loading, unavailable,
  error, and recovered states.
- Dependency report proving client domain stores do not reproduce daemon
  authority or authored wire schemas.
