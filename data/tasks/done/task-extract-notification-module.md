---
id: task-extract-notification-module
title: Extract notification gate and crash alert into a notifications module
status: done
priority: p2
area: architecture
summary: notification-gate.ts and module-crash-alert.ts live in core but notifications are explicitly called out in AGENTS.md as module territory. Moving them into src/modules/notifications/ shrinks core and follows the established extraction pattern.
created_at: 2026-04-09T07:00:00Z
updated_at: 2026-04-09T07:21:47Z
---

## Problem

`src/notification-gate.ts` (NotificationGate class, quiet hours logic) and
`src/module-crash-alert.ts` (crash alert threshold tracking) currently live at the top
level of `src/`. The architecture docs explicitly list notifications as a capability that
should prefer module-owned packs rather than accumulating in core. Both modules are
self-contained behavior that subscribes to the event bus rather than being core runtime
primitives.

## Desired Outcome

A new `src/modules/notifications/` module that:

- Owns `NotificationGate` class, `QuietHoursConfig`, and related helpers
- Owns `subscribeModuleCrashAlert` and its rolling-window threshold logic
- Is loaded by the module loader during daemon startup
- Exports any types or helpers that callers outside the module need

Core `src/notification-gate.ts` and `src/module-crash-alert.ts` are removed. Callers
import from the module or via the event bus.

## Constraints

- No change to `QuietHoursConfig` shape or quiet-hours behavior.
- NotificationGate patching of `bus.emit` must work identically after the move.
- Crash alert thresholds and cooldown behavior are unchanged.
- Module loads early enough that the gate is active before other modules emit events.

## Done When

- `src/modules/notifications/` exists and owns both modules.
- `src/notification-gate.ts` and `src/module-crash-alert.ts` are removed.
- All callers import from the module or use the bus.
- Quiet hours and crash alert behavior work unchanged.
- All tests pass.
