---
id: task-inbound-webhook-channel
title: Add generic inbound webhook-to-session channel
status: backlog
priority: p2
area: modules
summary: The ChannelDef protocol exists but no generic HTTP webhook channel uses it for inbound session creation. External services cannot start agent sessions via HTTP POST.
created_at: 2026-04-11T21:40:00Z
updated_at: 2026-04-11T21:40:00Z
---

## Problem

The channel protocol in `src/core/channels/channel.ts` defines `ChannelDef`
for inbound interaction surfaces, but only Telegram and Slack implement it.
There is no generic HTTP webhook channel that lets an arbitrary external
service (CI systems, monitoring alerts, custom integrations) start an agent
session by POSTing a JSON payload. Operators who want to wire external events
into KOTA must build a full channel adapter or abuse the daemon API directly.

## Desired Outcome

A new `webhook-channel` module (or extension of the existing `webhook` module)
that implements `ChannelDef` for inbound HTTP webhooks. An external service
POSTs a JSON payload to a daemon route; the channel validates it, starts a
session with the payload as context, and returns a session reference. The
channel should support optional HMAC signature verification for security.

## Constraints

- Use the existing `ChannelDef` protocol. Do not invent a parallel mechanism.
- The existing `webhook` module is outbound-only (notification delivery). Keep
  inbound and outbound concerns cleanly separated, whether in the same module
  or a new one.
- Register the inbound route through the module's route contribution, not by
  patching core daemon routes.
- Keep the payload schema generic (JSON body with optional `agent`, `message`,
  and `metadata` fields) rather than coupling to a specific external service.
- Document operator config in `docs/NOTIFICATIONS.md` or a new channel doc.

## Done When

- A `ChannelDef`-based inbound webhook channel exists and registers a daemon
  route.
- An HTTP POST with a JSON payload creates a session and returns a session
  reference.
- Optional HMAC signature verification is supported via config.
- At least one integration test covers the happy path.
- Operator config is documented.
