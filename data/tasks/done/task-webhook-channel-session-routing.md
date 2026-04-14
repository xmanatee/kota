---
id: task-webhook-channel-session-routing
title: Add session routing and multi-agent support to webhook-channel module
status: done
priority: p2
area: modules
summary: The webhook-channel module is minimal compared to slack-channel. It needs session routing so different webhook sources can target different agents and maintain separate conversation contexts.
created_at: 2026-04-12T01:10:00Z
updated_at: 2026-04-14T18:51:07.024Z
---

## Problem

The webhook-channel module (`src/modules/webhook-channel/`) currently has a
single index file and one test. The slack-channel module, by contrast, has a
bot client, session routing, and multi-file structure with comprehensive tests.

The inbound webhook channel was recently added but remains thin. An external
system posting to the webhook endpoint gets a single flat interaction surface.
There is no way to route different webhook sources to different agents or
maintain per-source session continuity. This limits the webhook channel to
simple one-shot interactions rather than sustained conversations.

## Desired Outcome

The webhook-channel module supports:
- Routing different webhook sources (identified by path, header, or payload
  field) to different agents.
- Maintaining session continuity per source so follow-up webhooks resume the
  same conversation.
- Configurable source-to-agent mapping in the module's operator config.

## Constraints

- Follow the channel protocol established by slack-channel and telegram.
- Use the existing `ChannelStartContext` identity fields for source tracking.
- Keep the module self-contained. Do not require core changes.
- Update `docs/NOTIFICATIONS.md` with the new operator config surface.

## Done When

- Webhook payloads with a source identifier are routed to configured agents.
- Follow-up webhooks from the same source resume the existing session.
- Operator config for source-to-agent mapping is documented.
- Tests cover routing, session continuity, and misconfigured-source rejection.
