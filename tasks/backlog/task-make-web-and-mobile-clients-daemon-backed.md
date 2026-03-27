---
id: task-make-web-and-mobile-clients-daemon-backed
title: Make web and mobile clients daemon-backed
status: backlog
priority: p1
area: api
summary: Web and mobile should connect to the daemon over the same control API instead of requiring separate KOTA runtimes or direct state-file access.
created_at: 2026-03-27T18:48:30Z
updated_at: 2026-03-27T18:48:30Z
---

## Problem

KOTA can expose HTTP routes today, but the architecture does not yet cleanly
separate the daemon as runtime host from web/mobile clients as consumers of one
control plane.

## Desired Outcome

Web and mobile clients can inspect and control the daemon through the same API
and event streams used by other clients.

## Constraints

- Do not introduce a web-only or mobile-only runtime path.
- Reuse the daemon control API rather than inventing client-specific live-state
  mechanisms.
- Keep the distinction between operator clients and daemon-owned channels clear.

## Done When

- The daemon API is sufficient for web and mobile status/control use cases.
- The web app no longer depends on a separate KOTA runtime to inspect live
  state.
- The architecture docs describe web/mobile as daemon clients, not parallel
  hosts.
