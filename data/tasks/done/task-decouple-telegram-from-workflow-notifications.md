---
id: task-decouple-telegram-from-workflow-notifications
title: Decouple Telegram from workflow runtime notification callers
status: done
priority: p2
area: architecture
summary: Four workflow-runtime modules call Telegram directly via callTelegramApi and TELEGRAM_* env vars — failure-alert.ts, approval-notification.ts, budget-guard.ts, and attention-digest.ts. This couples the workflow domain to the Telegram transport, contradicting the channel contribution model used for telegram-status-poll and violating the no-cross-layer-leakage principle.
created_at: 2026-03-30T16:00:00Z
updated_at: 2026-03-30T16:19:34Z
---

## Problem

The workflow runtime contains four files that call `callTelegramApi` and
read `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` directly:

- `src/workflow/failure-alert.ts` — sends alert on workflow failure/interrupt
- `src/workflow/approval-notification.ts` — notifies when approval is requested
- `src/workflow/budget-guard.ts` — sends alert when daily budget is exceeded
- `src/workflow/attention-digest.ts` — sends digest and budget warn to Telegram

This contradicts the channel contribution model introduced for
`telegram-status-poll`, where Telegram-specific I/O was moved into the Telegram
extension via a `ChannelDef`. The workflow runtime should not know about Telegram;
it should only emit events or invoke typed notification callbacks that the
Telegram extension subscribes to.

The current pattern also means:
- Budget alerts, failure alerts, and approval notifications are silently dropped
  if Telegram credentials are absent with no fallback path.
- Adding a second notification surface (e.g. desktop notify, webhook) requires
  editing workflow-core files.
- Tests for `BudgetGuard`, `AttentionDigest`, etc. must either mock the Telegram
  module or rely on env var absence.

## Desired Outcome

The four workflow-runtime callers above no longer import `callTelegramApi` or
read Telegram env vars. Instead:

- They emit structured bus events (e.g. `"workflow.budget.exceeded"`,
  `"workflow.failure.alert"`) or accept a typed notification callback injected
  at startup.
- The Telegram extension subscribes to these events (or receives the callback)
  and sends the messages.
- The abstraction boundary means new notification surfaces can subscribe
  independently.

## Constraints

- Do not change the observable behavior — the same Telegram messages should be
  sent under the same conditions.
- Do not introduce a heavyweight notification framework; keep the boundary thin.
- `src/workflow/` must not import from `src/telegram-client.ts` after the change.
- Prefer bus events over injected callbacks where the event is already a
  naturally useful domain signal (e.g. `workflow.budget.exceeded`).
- `ExtensionEventProxy` currently only has `emit` — no `subscribe`. Add a
  `subscribe` method to `ExtensionEventProxy` so the Telegram extension can
  listen for events in its `onLoad` handler without importing `EventBus` directly.
- Existing tests must pass; improve testability as a side effect.

## Done When

- `failure-alert.ts`, `approval-notification.ts`, `budget-guard.ts`, and
  `attention-digest.ts` contain no imports of `callTelegramApi` or references
  to `TELEGRAM_*` env vars.
- The Telegram extension subscribes to the relevant events and sends the alerts.
- `src/event-bus-types.ts` documents any new event types added.
- All existing tests pass; no regressions in Telegram alert behavior.
