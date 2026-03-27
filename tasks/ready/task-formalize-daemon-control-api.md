---
id: task-formalize-daemon-control-api
title: Formalize the daemon control API as the live source of truth
status: ready
priority: p1
area: runtime
summary: KOTA has a daemon, a server, and several status/control routes, but no single formal daemon API. Define and implement the daemon-owned HTTP+JSON+SSE control surface so clients stop scraping .kota state directly.
created_at: 2026-03-27T18:48:30Z
updated_at: 2026-03-27T18:48:30Z
---

## Problem

Live control is currently split across multiple surfaces:

- `kota daemon` owns workflows
- `kota serve` owns HTTP/session APIs
- some status routes still read `.kota/` files directly

That makes the daemon hard to treat as the single runtime host and blocks clean
native/web/mobile clients.

## Desired Outcome

The daemon exposes one clear live control API for status, workflow control, run
inspection, and session-aware clients.

## Constraints

- Reuse the existing HTTP/SSE direction where it is sound; do not add a second
  control protocol.
- The daemon should remain loopback-local by default.
- Durable `.kota/` files remain persistence and audit evidence, not the live
  control boundary.

## Done When

- The daemon has a documented HTTP+JSON+SSE control API surface.
- Live daemon, workflow, and session status can be queried from the daemon
  itself rather than inferred from `.kota/` files.
- Existing routes that read `.kota/` directly for live control are removed or
  rewritten to use daemon-owned state.
- Docs reflect the daemon API as the canonical live control surface.
