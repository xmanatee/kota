# Telegram Extension

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- `approval.requested` is always forwarded. Other events (`workflow.build.committed`, etc.) are opt-in via config `events`.
## Files

- `index.ts` — `KotaExtension` definition; wires CLI command, channel contribution, and event subscriptions.
- `bot.ts` — `TelegramBot` class; interactive long-poll bot with per-chat `AgentSession`s. Re-exports `callTelegramApi`, `splitMessage`, `TelegramTransport`.
- `client.ts` — `callTelegramApi` HTTP helper, `splitMessage`, `TelegramTransport`, and Telegram API types.
- `status-poll.ts` — `startTelegramStatusPoll`; lightweight daemon status poll that responds to `/status` commands.
- `bot.test.ts` — unit tests for `TelegramBot`, `TelegramTransport`, `callTelegramApi`, and `splitMessage`.
- `status-poll.test.ts` — unit tests for `buildStatusText` and `startTelegramStatusPoll`.
- `telegram.test.ts` — unit tests for extension load/unload and event forwarding.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
