---
status: done
---

# Forward approval.requested events through the webhook module

## Problem

`src/modules/webhook.ts` forwards five notification events (`workflow.failure.alert`,
`workflow.budget.exceeded`, `workflow.attention.digest`, `workflow.cost.limit.reached`,
`workflow.cost.anomaly`) but does not subscribe to `approval.requested`. The Slack
module always forwards `approval.requested` regardless of the event filter, and
the Telegram module does the same. Operators who use the generic webhook module
to route alerts into PagerDuty, OpsGenie, or a custom receiver will silently miss
approval notifications — the approval queue fills up unnoticed until something times out.

## Desired Outcome

The webhook module subscribes to `approval.requested` alongside the existing
notification events. Like the Slack module, `approval.requested` is forwarded
regardless of the `events` filter when the module is configured. The payload
follows the same shape as other events: `{ event, timestamp, ...approvalPayload }`.

Operators who want to suppress approval forwarding can omit it from a future
per-event disable mechanism, but for now the consistent behavior with Slack and
Telegram is the goal.

## Constraints

- `approval.requested` must be forwarded even when the operator specifies a custom
  `events` array that does not include it, mirroring the Slack module's behavior.
- No new config fields are required for this task.
- The payload shape must match the existing `BusEvents["approval.requested"]` type.
- No changes to the daemon, event bus, or approval queue — this is an module-only change.

## Done When

- The webhook module subscribes to `approval.requested` and POSTs it to configured URLs.
- The event is forwarded regardless of the `events` filter (consistent with Slack behavior).
- Unit test covers the approval forwarding path alongside the existing notification event tests.
- `docs/NOTIFICATIONS.md` notes that the webhook module forwards `approval.requested`.
