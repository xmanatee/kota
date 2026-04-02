---
id: task-webhook-approval-forwarding
title: Forward approval.requested events through the webhook extension
status: backlog
priority: p3
area: extensions
summary: The webhook extension forwards workflow notification events but not approval.requested, unlike Slack and Telegram. Operators routing KOTA alerts to PagerDuty or custom receivers won't receive approval notifications and may miss required reviews.
created_at: 2026-04-02T00:52:21Z
updated_at: 2026-04-02T00:52:21Z
---

## Problem

`src/extensions/webhook.ts` forwards five notification events (`workflow.failure.alert`,
`workflow.budget.exceeded`, `workflow.attention.digest`, `workflow.cost.limit.reached`,
`workflow.cost.anomaly`) but does not subscribe to `approval.requested`. The Slack
extension always forwards `approval.requested` regardless of the event filter, and
the Telegram extension does the same. Operators who use the generic webhook extension
to route alerts into PagerDuty, OpsGenie, or a custom receiver will silently miss
approval notifications — the approval queue fills up unnoticed until something times out.

## Desired Outcome

The webhook extension subscribes to `approval.requested` alongside the existing
notification events. Like the Slack extension, `approval.requested` is forwarded
regardless of the `events` filter when the extension is configured. The payload
follows the same shape as other events: `{ event, timestamp, ...approvalPayload }`.

Operators who want to suppress approval forwarding can omit it from a future
per-event disable mechanism, but for now the consistent behavior with Slack and
Telegram is the goal.

## Constraints

- `approval.requested` must be forwarded even when the operator specifies a custom
  `events` array that does not include it, mirroring the Slack extension's behavior.
- No new config fields are required for this task.
- The payload shape must match the existing `BusEvents["approval.requested"]` type.
- No changes to the daemon, event bus, or approval queue — this is an extension-only change.

## Done When

- The webhook extension subscribes to `approval.requested` and POSTs it to configured URLs.
- The event is forwarded regardless of the `events` filter (consistent with Slack behavior).
- Unit test covers the approval forwarding path alongside the existing notification event tests.
- `docs/NOTIFICATIONS.md` notes that the webhook extension forwards `approval.requested`.
