# Slack Channel Module

This directory owns the bidirectional Slack bot channel for KOTA.

- Uses Slack Socket Mode (WebSocket) to receive messages without a public HTTP endpoint.
- One `AgentSession` per Slack user — DMs go to that user's session.
- Approval requests are posted as interactive Block Kit messages with Approve/Reject buttons.
- Button clicks resolve the approval via `getApprovalQueue()` and update the Slack message.
- Separate from `../slack/` (one-way incoming webhook notifications).

## Config

Config lives under `modules.slackChannel` in `kota.config`:
- `botToken` — Bot Token (`xoxb-`). Required.
- `appToken` — App-Level Token (`xapp-`, Socket Mode). Required.
- `notifyChannel` — Slack channel ID for posting approval notifications. Optional.

See `docs/SLACK-CHANNEL.md` for Slack App setup instructions.

## Boundaries

- Does not own the one-way Slack webhook notification path (that lives in `../slack/`).
- Does not own the approval queue itself (`src/modules/approval-queue/queue.ts`).
- Does not add HTTP routes — all inbound traffic comes through Socket Mode WebSocket.
