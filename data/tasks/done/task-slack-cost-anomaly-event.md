---
id: task-slack-cost-anomaly-event
title: Add workflow.cost.anomaly subscription to Slack module
status: done
priority: p3
area: modules
summary: The Slack module does not forward workflow.cost.anomaly events, while the Telegram and webhook modules do. This inconsistency means operators using only Slack miss cost spike alerts that other channel users receive.
created_at: 2026-04-02T03:00:00Z
updated_at: 2026-04-02T03:29:03Z
---

## Problem

`src/modules/slack.ts` subscribes to four notification events (`workflow.failure.alert`,
`workflow.budget.exceeded`, `workflow.attention.digest`, `workflow.cost.limit.reached`) via
the `NOTIFICATION_EVENTS` constant, but does not include `workflow.cost.anomaly`.

The Telegram module (`telegram.ts:96`) subscribes to `workflow.cost.anomaly` directly.
The webhook module also includes it in its subscription list. A team relying on Slack
for KOTA alerts will silently miss cost spike notifications after each workflow run that
triggers an anomaly detection result.

## Desired Outcome

- `workflow.cost.anomaly` is added to the Slack module's `NOTIFICATION_EVENTS` array.
- The Slack module formats a `workflow.cost.anomaly` Block Kit message (workflow name,
  run cost, baseline, anomaly multiplier) consistent with how the Telegram module formats
  it — compact and actionable.
- The event is filterable via the existing `events` config array, same as the other four events.

## Constraints

- Follow the existing Block Kit `buildBlocks` switch pattern in `slack.ts`.
- No new config keys; the existing `events` filter already covers this.
- The Slack module must not require a restart to pick up the new subscription on first load.
- Update `src/modules/AGENTS.md` Slack entry to mention `workflow.cost.anomaly`.

## Done When

- `workflow.cost.anomaly` is in the `NOTIFICATION_EVENTS` list.
- `buildBlocks` handles the `workflow.cost.anomaly` case with a formatted Block Kit message.
- The Slack module test covers the new event case (mock payload → expected blocks).
- Existing Slack module tests pass unchanged.
