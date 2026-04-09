# Slack Channel

The `slack-channel` module adds a bidirectional Slack bot to KOTA using [Socket Mode](https://api.slack.com/apis/connections/socket). Operators can send messages to the KOTA bot and receive responses. Pending approval requests are posted as interactive messages with Approve/Reject buttons.

This is separate from the existing `slack` module, which is a one-way Incoming Webhook notification channel.

## Creating a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App → From Scratch**.
2. Give it a name (e.g., "KOTA") and select your workspace.

## Required Scopes

Under **OAuth & Permissions → Bot Token Scopes**, add:

| Scope | Purpose |
|---|---|
| `chat:write` | Send messages as the bot |
| `im:history` | Read DMs sent to the bot |
| `im:read` | List open DM channels |
| `im:write` | Open DMs with users |
| `channels:history` | Read messages in channels the bot is in |

## Socket Mode

1. Under **Settings → Socket Mode**, enable Socket Mode.
2. Click **Generate an app-level token** with the `connections:write` scope.
3. Copy the token — it starts with `xapp-`.

## Event Subscriptions

Under **Event Subscriptions**, enable events and subscribe to:

- `message.im` — DMs sent to the bot

## Interactive Components (for approval buttons)

Under **Interactivity & Shortcuts**, toggle **Interactivity** on. Socket Mode handles the interactivity endpoint automatically — no public URL is required.

## Install the App

Under **Install App**, click **Install to Workspace** and authorize. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

## Configuration

Add the following to your `kota.config` (`.kota/config.json`):

```json
{
  "modules": {
    "slackChannel": {
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "notifyChannel": "C012345ABCD"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `botToken` | Yes | Bot User OAuth Token (`xoxb-`) |
| `appToken` | Yes | App-Level Token for Socket Mode (`xapp-`) |
| `notifyChannel` | No | Channel ID where approval notifications are posted |

To find a channel's ID, open the channel in Slack, click the channel name, and copy the ID from the bottom of the panel.

## Usage

- **Chat**: Send a direct message to the bot. It maintains a per-user conversation history.
- **Approvals**: When a workflow action requires approval, a message with Approve/Reject buttons is posted to `notifyChannel`. Clicking a button resolves the approval immediately.
- **Reset session**: No `/clear` command is currently exposed; restart the daemon to clear sessions.

## Enabling the Module

The `slack-channel` module must be registered in your config's `modules` section. It is opt-in and does not affect the existing `slack` Incoming Webhook module.

```json
{
  "modules": {
    "slack": { "webhookUrl": "https://hooks.slack.com/..." },
    "slackChannel": { "botToken": "xoxb-...", "appToken": "xapp-..." }
  }
}
```
