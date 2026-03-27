---
id: task-telegram-interactive-status
title: Add inbound /status Telegram command to KOTA daemon
status: done
priority: p2
area: channel
summary: Telegram is currently used only for outbound alerts. Adding a simple /status inbound command would let operators query the current dispatch state, active run, and today's spend from Telegram without needing terminal access. The bot client and server infrastructure already exist.
created_at: 2026-03-27
updated_at: 2026-03-27T06:00:00Z
---

## Problem

Operators receive alerts via Telegram but cannot query KOTA's state from Telegram. Checking status requires SSH/terminal access and running `kota workflow status`. For casual monitoring (checking whether the daemon is paused, what's running, how much has been spent today) this is unnecessary friction.

## Desired Outcome

- The KOTA daemon's Telegram integration polls for or receives updates and responds to `/status`.
- `/status` response mirrors the key fields from `kota workflow status`: dispatch state (active/paused), active run ID and workflow, today's spend vs budget, and last-run status per workflow.
- Response is Markdown-formatted and fits within a single Telegram message.
- Unknown commands are ignored silently.

## Constraints

- Use Telegram's `getUpdates` long-polling API (already available via `callTelegramApi`). Do not add a webhook server — KOTA does not have a fixed public endpoint.
- Only respond if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` are set.
- Only accept commands from the configured chat ID to prevent unauthorized queries.
- Keep the polling loop lightweight; a 30-second interval is fine.
- Start polling in the daemon on startup, stop cleanly on shutdown.

## Done When

- Daemon subscribes to a Telegram poll loop on startup.
- `/status` from the configured chat returns current dispatch/spend/run state.
- Messages from unconfigured chats are ignored.
- The polling loop is tested with a mocked `callTelegramApi`.
