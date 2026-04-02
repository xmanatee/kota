# Notification Channels

KOTA emits workflow notification events on its internal event bus. Built-in
extensions (Telegram, webhook, Slack) subscribe to these events and forward
alerts to external services.

## Notification Events

| Event | When it fires |
|---|---|
| `workflow.failure.alert` | A workflow run ends with status `failed` or `interrupted` |
| `workflow.budget.exceeded` | Daily cost budget is exceeded |
| `workflow.attention.digest` | The attention digest fires (configurable interval) |
| `workflow.cost.limit.reached` | The hard cost circuit breaker trips |
| `workflow.cost.anomaly` | A run's cost significantly exceeds the historical baseline (opt-in via `costAnomalyThreshold`) |

Each event payload includes a human-readable `text` field plus structured fields
(e.g. `workflow`, `runId`, `status`).

## Telegram

Configure the Telegram extension by setting two environment variables:

```sh
export TELEGRAM_BOT_TOKEN=<your-bot-token>
export TELEGRAM_ALERT_CHAT_ID=<your-chat-id>
```

When both are set, all notification events are forwarded to that chat.

## Webhook

The built-in `webhook` extension POSTs a JSON payload to one or more HTTP
endpoints on each notification event. It also forwards `approval.requested` so
operators routing KOTA alerts to PagerDuty, OpsGenie, or a custom receiver
receive approval notifications. It is useful for Slack incoming webhooks,
Discord webhooks, PagerDuty, or any custom HTTP receiver.

Configure it in your KOTA config under the `webhook` key:

```json
{
  "extensions": {
    "webhook": {
      "urls": [
        "https://hooks.slack.com/services/T000/B000/xxxx",
        "https://discord.com/api/webhooks/000/xxxx"
      ]
    }
  }
}
```

To forward only a subset of the notification events, add an `events` array.
`approval.requested` is always forwarded regardless of the filter:

```json
{
  "extensions": {
    "webhook": {
      "urls": ["https://hooks.example.com/kota"],
      "events": ["workflow.failure.alert", "workflow.cost.limit.reached"]
    }
  }
}
```

### Payload shape

```json
{
  "event": "workflow.failure.alert",
  "timestamp": "2026-03-31T00:00:00.000Z",
  "text": "Workflow failed: builder\nRun: `run-abc`\nDuration: 12.3s",
  "workflow": "builder",
  "runId": "run-abc",
  "status": "failed",
  "durationMs": 12300,
  "errorSummary": ""
}
```

The `text` field is ready to display as-is. Each additional field comes from
the event payload and varies per event type.

Failed POSTs are retried up to 3 times with exponential backoff (1 s, 2 s, 4 s).
A warning is logged after all retries are exhausted. Retry count and base delay
are configurable:

```json
{
  "extensions": {
    "webhook": {
      "urls": ["https://hooks.example.com/kota"],
      "retries": 5,
      "retryDelayMs": 500
    }
  }
}
```

## Slack

The built-in `slack` extension sends Block Kit formatted messages to a Slack
Incoming Webhook on each notification event. It also forwards `approval.requested`
so operators can act on approvals from Slack.

No OAuth app or bot token required — only a webhook URL from Slack's
**Incoming Webhooks** app integration.

Configure it in your KOTA config under the `slack` key:

```json
{
  "extensions": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/T000/B000/xxxx"
    }
  }
}
```

To forward only a subset of the four notification events, add an `events` array.
`approval.requested` is always forwarded regardless of the filter.

```json
{
  "extensions": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/T000/B000/xxxx",
      "events": ["workflow.failure.alert", "workflow.cost.limit.reached"]
    }
  }
}
```

Messages use Block Kit and include at minimum: an event type header, workflow
name, run ID, and relevant detail (error summary, cost figures, approval
command). Failed POSTs are retried with the same exponential-backoff policy as
the webhook extension (3 retries by default). Configurable via `retries` and
`retryDelayMs` in the `slack` config block.

## Alert Cooldown

By default every failure emits an alert. To suppress repeated alerts for the
same workflow within a quiet window, set `notifications.alertCooldownMs` in
your KOTA config:

```json
{
  "notifications": {
    "alertCooldownMs": 300000
  }
}
```

This suppresses duplicate `workflow.failure.alert` events for the same workflow
for 5 minutes after the first alert. The first failure (or the first after the
window expires) always fires. Cooldown is per-workflow: a builder failure does
not suppress an explorer failure alert. The cooldown state is in-memory and
resets on daemon restart. Default: `0` (no cooldown — every failure fires).

## Adding a custom notification consumer

Subscribe to notification events in an extension's `onLoad` via `ctx.events.subscribe`:

```ts
const unsub = ctx.events.subscribe("workflow.failure.alert", (payload) => {
  // payload.text is the human-readable message
});
```

Unsubscribe in `onUnload` to avoid memory leaks.
