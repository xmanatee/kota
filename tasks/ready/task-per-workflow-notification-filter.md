---
id: task-per-workflow-notification-filter
title: Add per-workflow notification suppression to reduce alert noise from low-priority workflows
status: ready
priority: p3
area: runtime
summary: Channel notifications (Telegram, Slack, webhook) fire for every workflow event. A per-workflow notify config block lets operators suppress notifications for specific workflows without disabling the channel globally.
created_at: 2026-04-02T14:18:25Z
updated_at: 2026-04-08T16:17:29Z
---

## Problem

KOTA's notification channels (Telegram, Slack, webhook) deliver events globally
across all workflows. As operators add more workflows — internal housekeeping,
exploratory automations, low-stakes data fetches — the notification volume grows.
There is no way to say "only notify me about failures for this workflow" or "suppress
all notifications from this workflow" without disabling the channel for everything.

The `workflow.failure.alert` and `workflow.cost.anomaly` events carry the workflow
name in their payload, but notification extensions have no routing logic that reads it.

## Desired Outcome

A `notify` block in the workflow definition (or in `kota.config.json` under
`workflows.<name>.notify`) that controls which notification events the daemon
should emit for that workflow:

```ts
{
  notify: {
    onFailure: false,      // suppress workflow.failure.alert (default: true)
    onSuccess: false,      // suppress workflow.build.committed (default: false)
    onCostAnomaly: true,   // keep workflow.cost.anomaly (default: true)
  }
}
```

The daemon checks this config when constructing the notification payload and skips
the event bus emission (or filters out the event) if the matching flag is false.
Extensions do not need to change — suppression happens before they see the event.

## Constraints

- All flags default to current behavior (no opt-in required for existing workflows).
- Config can live in the workflow definition itself or in `kota.config.json`;
  definition-level config takes precedence over global defaults.
- Only notification-class events are affected (`workflow.failure.alert`,
  `workflow.cost.anomaly`, `workflow.build.committed`). Core bus events used by the
  scheduler or trigger system are not suppressed.
- No changes to channel extension interfaces.

## Done When

- Workflow definitions (or config) accept a `notify` block with per-event flags.
- Setting `notify.onFailure: false` for a workflow suppresses its failure alert
  notifications without affecting other workflows.
- The suppression is documented in `docs/WORKFLOWS.md`.
- Unit test covers: flag defaults, suppression of a specific event, non-affected events
  still fire.
