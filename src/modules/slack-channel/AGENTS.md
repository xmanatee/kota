# Slack Channel Module

This directory owns the bidirectional Slack bot channel for KOTA.

- Uses Slack Socket Mode (WebSocket) to receive messages without a public HTTP endpoint.
- One `AgentSession` per Slack user — DMs go to that user's session.
- Approval requests are posted as interactive Block Kit messages with Approve/Reject buttons.
- Button clicks resolve the approval via `getApprovalQueue()` and update the Slack message.
- Separate from `../slack/` (one-way incoming webhook notifications).

## Config

- Channel sessions use configured autonomy explicitly. Missing session-autonomy
  config is a startup error, not a hidden fallback.
- Keep the module-owned config shape, generated schema fragment, and focused
  startup tests aligned.

## Slack App Setup

Create a Slack App (api.slack.com/apps > Create New App > From Scratch).

Configure bot messaging scopes, enable Socket Mode with an app-level token,
subscribe to DM events, and enable interactivity. Socket Mode handles the
endpoint; install the app to the workspace and keep tokens in local config.

## Boundaries

- Does not own the one-way Slack webhook notification path (that lives in `../slack/`).
- Does not own the approval queue itself (`src/modules/approval-queue/queue.ts`).
- Does not add HTTP routes — all inbound traffic comes through Socket Mode WebSocket.
