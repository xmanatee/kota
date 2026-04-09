# Notifications Extension

This extension owns notification delivery, quiet-hours gating, and extension crash alerting.

- `notification-gate.ts` — `NotificationGate` class; patches `bus.emit` to hold non-critical channel events during configured quiet hours and releases them as a batched digest when the window ends. Critical events bypass the gate by default.
- `extension-crash-alert.ts` — `subscribeExtensionCrashAlert`; monitors `extension.restarted` events and emits `extension.crash.alert` when restart frequency exceeds a threshold within a rolling window.
- `index.ts` — `KotaExtension` definition; exports `NotificationGate`, `QuietHoursConfig`, and `subscribeExtensionCrashAlert` for callers that need to reference them by type.

The core loop and daemon import from this extension rather than owning notification concerns directly. Config wires the gate and crash alert at startup via the extension's init hook.
