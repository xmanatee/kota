---
status: dropped
---

# Build a native macOS menu bar client for the daemon

## Problem

There is no native desktop surface for KOTA's daemon. A menu bar app is a good
fit on macOS, but it must not become a second runtime or a platform-specific
control plane.

## Desired Outcome

A native macOS menu bar app can connect to the daemon, show live status, and
perform common operator actions.

## Constraints

- Use native macOS app technology, not a heavy cross-platform wrapper.
- The app must be a daemon client, not the runtime host.
- Prefer the same daemon API used by CLI, web, and mobile clients.
- Login-item or helper integration should fit the daemon model rather than hide
  a second process tree.

## Done When

- A native macOS menu bar app can connect to a running daemon.
- It can show core live state such as daemon health, active workflow, queue,
  and last failure/success.
- It can perform a small set of operator actions through the daemon API.
- The app does not parse `.kota/` files directly for live state.
