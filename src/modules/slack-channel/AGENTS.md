# Slack Channel Module

This directory owns the bidirectional Slack bot channel for KOTA.

- Uses Slack Socket Mode (WebSocket) to receive messages without a public HTTP endpoint.
- One `AgentSession` per Slack user — free-form DMs go to that user's session.
- Prefix-configured automation messages emit `inbound.signal.received` with
  project scope, Slack source metadata, and sender trust; workflows decide what
  the signal means.
- First-class slash commands match the Telegram channel's surface
  (`/recall`, `/answer`, `/answer-log`, `/answer-show`, `/capture` plus the
  four `/capture-to-{memory,knowledge,tasks,inbox}` twins, the four
  `/retract-{memory,knowledge,tasks,inbox}` correction commands, the
  per-store semantic-search seams `/memory`, `/knowledge`, `/history`,
  `/tasks`, and the on-demand `/attention` and `/digest` seams) — one-shot
  calls that bypass the per-user session, route through the matching
  `KotaClient` namespace (or attention/digest snapshot), and reuse the
  same module-owned plain-text renderers Telegram uses, so a Slack reply
  matches the Telegram reply byte-for-byte for the same envelope.
- Slash-command parsing tolerates leading whitespace, a leading bot-mention
  prefix, and matches the command head case-insensitively.
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
- Does not plan or classify chat-origin automation locally; it only normalizes
  configured updates into the shared inbound-signal contract.
