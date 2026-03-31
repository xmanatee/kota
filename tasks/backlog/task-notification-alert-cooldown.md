---
id: task-notification-alert-cooldown
title: Add per-workflow notification cooldown to suppress repeated failure alerts
status: backlog
priority: p3
area: runtime
summary: When a workflow fails multiple times in quick succession, every failure emits a separate alert. A cooldown window per workflow suppresses duplicate alerts and reduces notification noise without missing genuine failures.
created_at: 2026-03-31T06:27:52Z
updated_at: 2026-03-31T06:27:52Z
---

## Problem

`subscribeWorkflowFailureAlert` in `src/workflow/failure-alert.ts` emits a
`workflow.failure.alert` bus event for every failed or interrupted run. The
Telegram and webhook extensions forward each event immediately. When a workflow
fails in a tight loop (e.g., a bug causes builder to fail on every attempt),
operators receive a flood of nearly-identical messages — one per run — with no
way to configure a minimum quiet period between alerts for the same workflow.

## Desired Outcome

- A `notifications.alertCooldownMs` config field (default: `0` — no cooldown,
  backwards-compatible). Example: `alertCooldownMs: 300000` suppresses repeated
  alerts for the same workflow within 5 minutes of the first alert.
- `subscribeWorkflowFailureAlert` tracks the last alert time per workflow name
  in memory and skips emitting when the cooldown has not elapsed.
- The first failure after the cooldown window always fires an alert (guaranteed
  delivery — not debounce, but rate-limiting).
- No persistent state required; cooldown resets on daemon restart.

## Constraints

- Default behavior (`alertCooldownMs` unset or `0`) is fully preserved — no
  change to alert behavior without explicit config.
- Cooldown is per workflow name, not global — a builder failure does not
  suppress an explorer failure alert.
- The suppressed-alert count is not surfaced in the notification message (keep
  it simple for a first pass).
- No changes to the `workflow.failure.alert` bus event schema or the Telegram/
  webhook extension subscription logic — the cooldown lives in the emitter, not
  the consumers.

## Done When

- `notifications.alertCooldownMs` is accepted in kota config.
- When set, repeated failure alerts for the same workflow within the cooldown
  window are suppressed.
- The first failure (or first after the window expires) always fires.
- At least one unit test covers: single failure fires, second within window is
  suppressed, third after window expires fires again.
- Config field is documented alongside the existing notification config docs.
