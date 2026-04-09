---
id: task-extract-notification-extension
title: Extract notification gate and crash alert into a notifications extension
status: ready
priority: p2
area: architecture
summary: notification-gate.ts and extension-crash-alert.ts live in core but notifications are explicitly called out in AGENTS.md as extension territory. Moving them into src/extensions/notifications/ shrinks core and follows the established extraction pattern.
created_at: 2026-04-09T07:00:00Z
updated_at: 2026-04-09T07:21:47Z
---

## Problem

`src/notification-gate.ts` (NotificationGate class, quiet hours logic) and
`src/extension-crash-alert.ts` (crash alert threshold tracking) currently live at the top
level of `src/`. The architecture docs explicitly list notifications as a capability that
should prefer extension-owned packs rather than accumulating in core. Both modules are
self-contained behavior that subscribes to the event bus rather than being core runtime
primitives.

## Desired Outcome

A new `src/extensions/notifications/` extension that:

- Owns `NotificationGate` class, `QuietHoursConfig`, and related helpers
- Owns `subscribeExtensionCrashAlert` and its rolling-window threshold logic
- Is loaded by the extension loader during daemon startup
- Exports any types or helpers that callers outside the extension need

Core `src/notification-gate.ts` and `src/extension-crash-alert.ts` are removed. Callers
import from the extension or via the event bus.

## Constraints

- No change to `QuietHoursConfig` shape or quiet-hours behavior.
- NotificationGate patching of `bus.emit` must work identically after the move.
- Crash alert thresholds and cooldown behavior are unchanged.
- Extension loads early enough that the gate is active before other extensions emit events.

## Done When

- `src/extensions/notifications/` exists and owns both modules.
- `src/notification-gate.ts` and `src/extension-crash-alert.ts` are removed.
- All callers import from the extension or use the bus.
- Quiet hours and crash alert behavior work unchanged.
- All tests pass.
