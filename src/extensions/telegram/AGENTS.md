# Telegram Extension

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- `approval.requested` is always forwarded. Other events (`workflow.build.committed`, etc.) are opt-in via config `events`.
- Bot logic lives in `src/telegram.ts`; Telegram API calls go through `src/telegram-client.ts`.
- The status poll helper lives in `src/workflow/telegram-status-poll.ts`.

## Files

- `index.ts` — `KotaExtension` definition; wires CLI command, channel contribution, and event subscriptions.
- `telegram.test.ts` — unit tests for extension load/unload and event forwarding.

## Boundaries

- Does not own the Telegram bot protocol implementation (that lives in `src/telegram.ts` and `src/telegram-client.ts`).
- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
