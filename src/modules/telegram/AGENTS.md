# Telegram Module

This directory owns the Telegram integration — interactive bot access and notification forwarding.

- Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll via `/status`), and notification subscriptions for workflow events.
- Optional event filters must not suppress urgent owner/approval escalation
  notifications.

## Boundaries

- Does not own Slack or generic webhook notification (those belong in `slack/` and `webhook/`).
- Does not own inbound webhook validation for other services.
