# Notification Channels

KOTA emits workflow notification events on its internal event bus. Built-in
extensions (Telegram, webhook) subscribe to these events and forward alerts to
external services.

## Notification Events

| Event | When it fires |
|---|---|
| `workflow.failure.alert` | A workflow run ends with status `failed` or `interrupted` |
| `workflow.budget.exceeded` | Daily cost budget is exceeded |
| `workflow.attention.digest` | The attention digest fires (configurable interval) |
| `workflow.cost.limit.reached` | The hard cost circuit breaker trips |

Each event payload includes a human-readable `text` field plus structured fields
(e.g. `workflow`, `runId`, `status`).

## Telegram

Configure the Telegram extension by setting two environment variables:

```sh
export TELEGRAM_BOT_TOKEN=<your-bot-token>
export TELEGRAM_ALERT_CHAT_ID=<your-chat-id>
```

When both are set, all four notification events are forwarded to that chat.

## Webhook

The built-in `webhook` extension POSTs a JSON payload to one or more HTTP
endpoints on each notification event. It is useful for Slack incoming webhooks,
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

To forward only a subset of events, add an `events` array:

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

POSTs are fire-and-forget — no retry is attempted on failure.

## Adding a custom notification consumer

Subscribe to notification events in an extension's `onLoad` via `ctx.events.subscribe`:

```ts
const unsub = ctx.events.subscribe("workflow.failure.alert", (payload) => {
  // payload.text is the human-readable message
});
```

Unsubscribe in `onUnload` to avoid memory leaks.
