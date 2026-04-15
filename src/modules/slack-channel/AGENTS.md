# Slack Channel Module

This directory owns the bidirectional Slack bot channel for KOTA.

- Uses Slack Socket Mode (WebSocket) to receive messages without a public HTTP endpoint.
- One `AgentSession` per Slack user — DMs go to that user's session.
- Approval requests are posted as interactive Block Kit messages with Approve/Reject buttons.
- Button clicks resolve the approval via `getApprovalQueue()` and update the Slack message.
- Separate from `../slack/` (one-way incoming webhook notifications).

## Config

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

- `botToken` — Bot User OAuth Token (`xoxb-`). Required.
- `appToken` — App-Level Token for Socket Mode (`xapp-`). Required.
- `notifyChannel` — Channel ID for posting approval notifications. Optional.

## Slack App Setup

Create a Slack App (api.slack.com/apps > Create New App > From Scratch).

Required bot token scopes: `chat:write`, `im:history`, `im:read`, `im:write`,
`channels:history`.

Enable Socket Mode under Settings > Socket Mode and generate an app-level token
with `connections:write` scope. Subscribe to `message.im` under Event
Subscriptions. Enable Interactivity (Socket Mode handles the endpoint). Install
to workspace and copy the Bot User OAuth Token.

## Boundaries

- Does not own the one-way Slack webhook notification path (that lives in `../slack/`).
- Does not own the approval queue itself (`src/modules/approval-queue/queue.ts`).
- Does not add HTTP routes — all inbound traffic comes through Socket Mode WebSocket.
