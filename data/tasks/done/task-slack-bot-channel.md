---
id: task-slack-bot-channel
title: Add Slack bot as a two-way ChannelDef for interactive KOTA conversations via Slack
status: done
priority: p2
area: modules
summary: The existing Slack module sends one-way notifications via Incoming Webhook. A Slack bot channel using the Slack Events API and Socket Mode would let operators chat with KOTA and approve workflow requests directly in Slack, without switching to a terminal or web UI.
created_at: 2026-04-02T11:49:09Z
updated_at: 2026-04-09T00:49:00Z
---

## Problem

The current `slack` module is one-way: KOTA posts notifications to Slack but cannot receive messages or approvals from operators there. Operators must switch to the CLI or web UI to respond to pending approvals or send commands to KOTA. Teams that live in Slack need to context-switch for every KOTA interaction.

The `channel` protocol and `ChannelDef` type were introduced precisely for this use case — a two-way interaction surface. Telegram already has a full bidirectional channel; Slack should have the same capability.

## Desired Outcome

A new `slack-channel` module (separate from the existing notification `slack` module) that contributes a `ChannelDef` using Slack's Socket Mode API:

- Operators can message the KOTA Slack bot and receive responses.
- Pending approval requests are posted as interactive Slack messages with Approve/Reject buttons (Block Kit actions).
- The channel routes inbound messages to a dedicated `ChannelSession` per Slack user.
- Bot token and app credentials are configured under a `slackChannel` key in `config.modules`.

The existing `slack` notification module is unchanged.

## Constraints

- Requires a Slack App with Socket Mode enabled, Bot Token (`xoxb-`), and App-Level Token (`xapp-`). Config must document these.
- Use `ChannelDef` and `ChannelAdapter` from `src/core/channels/channel.ts` — do not hardcode channel logic into the daemon.
- Approval button interactions go through Slack's interactivity endpoint; Socket Mode can handle this without a public URL.
- This module is opt-in; operators who only want notifications keep using the existing `slack` module.
- Document setup steps in `docs/` (Slack App configuration, required scopes, Socket Mode toggle).

## Done When

- A `slack-channel` module is loadable from `config.modules`.
- Operators can send a message to the KOTA Slack bot and receive a reply.
- Pending approvals are posted as interactive messages; clicking Approve or Reject calls the daemon approval endpoint.
- The channel is documented with setup instructions and required Slack App scopes.
- The existing `slack` notification module behavior is unaffected.
