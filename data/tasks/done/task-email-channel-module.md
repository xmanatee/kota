---
id: task-email-channel-module
title: Add email channel module for KOTA interactions via email
status: done
priority: p3
area: modules
summary: The channel module pattern supports multiple interaction surfaces, but only Telegram is implemented. An email channel would let operators interact with KOTA via email, broadening reach without requiring a messaging app.
created_at: 2026-03-31T03:42:35Z
updated_at: 2026-04-10T05:05:00Z
---

## Problem

KOTA's channel architecture (`ChannelDef` in `src/core/channels/channel.ts`) is designed for multiple
transport backends, but only a Telegram channel module exists today. Operators who
don't use Telegram have no way to receive workflow alerts or send commands via a channel.
Email is nearly universal and would expand KOTA's reach to any operator environment.

## Desired Outcome

An `email` module in `src/modules/` that contributes a `ChannelDef`. The channel:

- **Outbound**: Sends workflow alerts (`workflow.failure.alert`, `workflow.attention.digest`,
  `workflow.budget.exceeded`) as emails via SMTP. Subscribes to the bus events that Telegram
  already handles, following the `ModuleEventProxy.subscribe()` pattern.
- **Inbound (optional / stretch)**: Polls an IMAP mailbox or accepts inbound webhook
  (SendGrid, Mailgun) to receive operator replies and route them to an active session.
- Configured via `config.modules` with SMTP credentials, from/to addresses, and an
  optional IMAP/webhook config for inbound.

Architecture reference: [Telegram module](src/modules/telegram/index.ts) for bus subscription
pattern; [channel.ts](src/core/channels/channel.ts) for `ChannelDef` contract.

## Constraints

- Use `nodemailer` or a similarly established Node.js SMTP library; do not implement raw SMTP.
- Follow the same `onLoad` / `onUnload` lifecycle as the Telegram module.
- Keep credentials out of logs; follow the secrets pattern used by the Telegram module.
- Inbound support is a stretch goal; outbound alerts are the required baseline.
- Do not modify the core notification bus or daemon to support this; use existing module hooks.

## Done When

- The email module loads from `config.modules` and contributes a `ChannelDef`.
- Workflow failure alerts and attention digests are sent as emails when SMTP is configured.
- Module is disabled gracefully (no crash) when SMTP config is absent.
- At least one unit test covers message formatting; SMTP sending is integration-tested or
  verified manually with a local SMTP sink.
