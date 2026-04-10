# Telegram Module

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- `approval.requested` is always forwarded. Other events (`workflow.build.committed`, etc.) are opt-in via config `events`.
## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
