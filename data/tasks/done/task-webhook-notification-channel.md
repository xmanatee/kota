---
id: task-webhook-notification-channel
title: Generic HTTP webhook notification channel module
status: done
priority: p3
area: runtime
summary: Telegram is the only notification channel today. A generic HTTP webhook channel lets operators route alerts and digests to Slack, Discord, PagerDuty, or any custom endpoint without building a dedicated module for each service.
created_at: 2026-03-30T20:20:00Z
updated_at: 2026-03-31T00:05:00Z
---

## Problem

Notifications (failure alerts, attention digests, budget warnings) are routed through
the Telegram module. Operators who do not use Telegram must fork the module or
go without notifications. The channel and event-bus abstractions are already in place
to support additional notification consumers, but no generic option exists.

## Desired Outcome

A built-in `webhook` module that:
- Subscribes to the same bus events as the Telegram module
  (`workflow.failure.alert`, `workflow.attention.digest`, `workflow.budget.exceeded`,
  `workflow.cost.limit.reached`).
- On each event, POSTs a JSON payload to one or more configured `webhookUrl` endpoints.
- Payload shape: `{ event, timestamp, text, ...eventPayload }` — enough for Slack
  incoming webhooks, Discord webhooks, or custom receivers to render a useful message.
- Configured via `kota.config` under the `webhook` module key:
  `{ urls: string[], events?: string[] }` (default: all notification events).
- No channel session or interactive routing needed — fire-and-forget HTTP POST only.

## Constraints

- Implement as a standard `KotaModule` contributing no tools, agents, workflows,
  or channels — just `onLoad`/`onUnload` event subscriptions.
- Timeout and retry are out of scope; a single best-effort POST per event is enough.
- Must not affect Telegram or other notification paths.
- Include a short example config snippet in `docs/FOREIGN-MODULES.md` or a new
  `docs/CHANNELS.md` if one does not yet exist.

## Done When

- `webhook` module subscribes to notification events and POSTs JSON to configured URLs.
- Disabling or omitting the module config leaves notification behavior unchanged.
- At least one unit test confirms the POST is triggered with the expected payload shape.
- Config schema documented (inline JSDoc or docs file).
