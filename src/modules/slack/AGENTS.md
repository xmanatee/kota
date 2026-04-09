# Slack Module

This directory owns the Slack notification module — routes KOTA notification events to a Slack Incoming Webhook.

- No OAuth app or bot token required; only a webhook URL (`modules.slack.webhookUrl`).
- `approval.requested` is always forwarded when the module is configured.
- Default notification events: `workflow.failure.alert`, `workflow.budget.exceeded`, `workflow.attention.digest`, `workflow.cost.limit.reached`, `workflow.cost.anomaly`.
- `workflow.build.committed` is opt-in (must be listed in config `events`).
- Uses `postWithRetry` from `../notify-retry.ts` for delivery with exponential-backoff retry.

## Files

- `index.ts` — `KotaModule` definition; implements event subscription and Block Kit message formatting.
- `slack.test.ts` — unit tests for event subscription and message delivery.

## Boundaries

- Does not own Telegram or generic webhook notification (those belong in `telegram/` and `webhook/`).
- Does not own inbound Slack interactions or slash commands.
- Does not own retry logic (that lives in `../notify-retry.ts`).
