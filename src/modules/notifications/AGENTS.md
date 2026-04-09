# Notifications Module

This module owns notification delivery, quiet-hours gating, and module crash alerting.

- `notification-gate.ts` — `NotificationGate` class; patches `bus.emit` to hold non-critical channel events during configured quiet hours and releases them as a batched digest when the window ends. Critical events bypass the gate by default.
- `module-crash-alert.ts` — `subscribeModuleCrashAlert`; monitors `module.restarted` events and emits `module.crash.alert` when restart frequency exceeds a threshold within a rolling window.
- `index.ts` — `KotaModule` definition; exports `NotificationGate`, `QuietHoursConfig`, and `subscribeModuleCrashAlert` for callers that need to reference them by type.

The core loop and daemon import from this module rather than owning notification concerns directly. Config wires the gate and crash alert at startup via the module's init hook.
