# Telegram Module

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- `approval.requested` is always forwarded. Other events (`workflow.build.committed`, etc.) are opt-in via config `events`.
## Files

- `index.ts` — `KotaModule` definition; wires CLI command, channel contribution, event subscriptions, and approval callback poll lifecycle.
- `bot.ts` — `TelegramBot` class; interactive long-poll bot with per-chat `AgentSession`s. Re-exports `callTelegramApi`, `splitMessage`, `TelegramTransport`.
- `client.ts` — `callTelegramApi` HTTP helper, `splitMessage`, `TelegramTransport`, and Telegram API types including `TelegramCallbackQuery`.
- `approval-callback-poll.ts` — `startApprovalCallbackPoll`; background long-poll loop that receives inline-keyboard callback queries (Approve / Reject buttons), routes them to `ApprovalQueue`, and edits the original message with the outcome.
- `status-poll.ts` — `startTelegramStatusPoll`; lightweight daemon status poll that responds to `/status` commands.
- `approval-callback-poll.test.ts` — unit tests for `startApprovalCallbackPoll`.
- `bot.test.ts` — unit tests for `TelegramBot`, `TelegramTransport`, `callTelegramApi`, and `splitMessage`.
- `status-poll.test.ts` — unit tests for `buildStatusText` and `startTelegramStatusPoll`.
- `telegram.test.ts` — unit tests for module load/unload and event forwarding.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
