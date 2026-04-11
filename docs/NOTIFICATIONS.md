# Notification Channels

KOTA emits workflow notification events on its internal event bus. Shipped
modules (Telegram, webhook, Slack, email) subscribe to these events and forward
alerts to external services.

## Notification Events

| Event | When it fires | Opt-in? |
|---|---|---|
| `workflow.failure.alert` | A workflow run ends with status `failed` or `interrupted` | No |
| `workflow.budget.exceeded` | Daily cost budget is exceeded | No |
| `workflow.budget.warning` | Daily cost crosses the configured `budget.warnAt` soft-limit threshold | No |
| `workflow.attention.digest` | The attention digest fires (configurable interval) | No |
| `workflow.cost.limit.reached` | The hard cost circuit breaker trips | No |
| `workflow.cost.anomaly` | A run's cost significantly exceeds the historical baseline (requires `costAnomalyThreshold`) | Yes |
| `workflow.build.committed` | Builder workflow successfully commits a task change | Yes |
| `workflow.approval.expired` | An approval step auto-resolved (approved or denied) due to `timeoutMs` firing | No |

Opt-in events are not forwarded by default. Add them to the module's `events` config array to enable them (see per-module sections below).

Each event payload includes a human-readable `text` field plus structured fields
(e.g. `workflow`, `runId`, `status`).

### `workflow.approval.expired` payload

| Field | Type | Description |
|---|---|---|
| `workflowName` | `string` | Name of the workflow that owns the approval step |
| `runId` | `string` | Run ID |
| `stepId` | `string` | ID of the approval step that timed out |
| `resolution` | `"approve" \| "deny"` | How the step auto-resolved (from `defaultResolution`) |
| `reason` | `string` (optional) | Step `reason` field if present |
| `text` | `string` | Human-readable summary for display |

This event fires when `timeoutMs` is set on the approval step and the timeout elapses without a human decision. If `defaultResolution` is omitted the step auto-denies (the default). Manual approvals and rejections do not emit this event.

## Telegram

Configure the Telegram module by setting two environment variables:

```sh
export TELEGRAM_BOT_TOKEN=<your-bot-token>
export TELEGRAM_ALERT_CHAT_ID=<your-chat-id>
```

When both are set, all notification events are forwarded to that chat.
`approval.requested` is always forwarded regardless of any event filter.

Approval request messages include inline **Approve** and **Reject** buttons.
Pressing a button resolves the approval immediately and edits the original
message to show the outcome. Resolution source is recorded as
`"telegram-inline"`. Manual CLI resolution (`kota approval approve/reject`) also
works and updates the message if the inline button has not yet been pressed.

## Email

The project `email` module sends SMTP emails for all notification events. No API
token required — only SMTP credentials and from/to addresses.

Configure it in your KOTA config under the `email` key:

```json
{
  "modules": {
    "email": {
      "smtp": {
        "host": "smtp.example.com",
        "port": 587,
        "secure": false,
        "auth": { "user": "kota@example.com", "pass": "secret" }
      },
      "from": "kota@example.com",
      "to": "operator@example.com"
    }
  }
}
```

`smtp.host`, `from`, and `to` are required. When any of these are absent the
module loads but sends nothing. `smtp.port` defaults to 587 (STARTTLS). Set
`smtp.secure: true` for port 465 (TLS). `smtp.auth` is optional for
unauthenticated relays.

`to` accepts a string or an array of addresses for multiple recipients.

To opt in to events that are off by default, add an `events` array:

```json
{
  "modules": {
    "email": {
      "smtp": { "host": "smtp.example.com" },
      "from": "kota@example.com",
      "to": "operator@example.com",
      "events": ["workflow.build.committed"]
    }
  }
}
```

The module verifies the SMTP connection on daemon startup and logs a warning if
the connection fails (it does not prevent daemon startup). SMTP credentials are
never logged.

## Webhook

The project `webhook` module POSTs a JSON payload to one or more HTTP
endpoints on each notification event. It also forwards `approval.requested` so
operators routing KOTA alerts to PagerDuty, OpsGenie, or a custom receiver
receive approval notifications. It is useful for Slack incoming webhooks,
Discord webhooks, PagerDuty, or any custom HTTP receiver.

Configure it in your KOTA config under the `webhook` key:

```json
{
  "modules": {
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
  "modules": {
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
  "modules": {
    "webhook": {
      "urls": ["https://hooks.example.com/kota"],
      "retries": 5,
      "retryDelayMs": 500
    }
  }
}
```

## Slack

The project `slack` module sends Block Kit formatted messages to a Slack
Incoming Webhook on each notification event. It also forwards `approval.requested`
so operators can act on approvals from Slack.

No OAuth app or bot token required — only a webhook URL from Slack's
**Incoming Webhooks** app integration.

Configure it in your KOTA config under the `slack` key:

```json
{
  "modules": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/T000/B000/xxxx"
    }
  }
}
```

To forward only a subset of the notification events, add an `events` array.
`approval.requested` is always forwarded regardless of the filter.

```json
{
  "modules": {
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
the webhook module (3 retries by default). Configurable via `retries` and
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

## Channel Identity

Channels receive a `ChannelStartContext` from the daemon at startup. This
context includes typed identity fields for the operator running this daemon
instance. Set the operator via environment variable:

```sh
export KOTA_OPERATOR=michael
```

When set, the value is available to all channel adapters as both `ctx.operator`
(plain string) and `ctx.identity` (typed `ChannelOperatorIdentity` with
`operator` and optional `meta` fields).

Channel adapters can also attach per-user identity (`ChannelUserIdentity`) to
sessions they create. This lightweight attribution surface carries:

| Field | Type | Description |
|---|---|---|
| `channelUserId` | `string` | Channel-specific user identifier (e.g., Telegram chat ID) |
| `displayName` | `string?` | Human-readable name when available |
| `channel` | `string` | Which channel the identity came from (e.g., `"telegram"`) |
| `meta` | `Record<string, unknown>?` | Arbitrary adapter-specific metadata |

The Telegram adapter populates these fields automatically from incoming
messages. Other adapters can populate them as needed. Sessions created via a
channel carry the identity forward so that guardrails, audit events, and cost
tracking can attribute actions without channel-specific knowledge.

Identity is informational — it is not an auth/authz mechanism.

## Adding a custom notification consumer

Subscribe to notification events in a module's `onLoad` via `ctx.events.subscribe`:

```ts
const unsub = ctx.events.subscribe("workflow.failure.alert", (payload) => {
  // payload.text is the human-readable message
});
```

Unsubscribe in `onUnload` to avoid memory leaks.
