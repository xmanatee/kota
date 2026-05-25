---
id: task-route-slack-and-telegram-updates-through-the-inbou
title: Route Slack and Telegram updates through the inbound-signal contract
status: backlog
priority: p2
area: channel
summary: Map bidirectional chat channel updates into the shared inbound.signal.received contract while keeping chat modules thin.
created_at: 2026-05-25T02:48:53.898Z
updated_at: 2026-05-25T02:48:53.898Z
---

## Problem

Slack and Telegram already receive user messages through bidirectional channel
adapters, but those messages currently route into interactive sessions and
slash-command handling rather than the shared inbound automation contract.
Without an adapter slice, chat-driven bounded automation can drift into
provider-local planners.

## Desired Outcome

Configured Slack and Telegram updates that should trigger bounded automation
are normalized into `inbound.signal.received` with project scope, channel
identity, sender trust, source id, timestamp, and message/action content.
Interactive chat sessions and slash commands continue to use the existing
channel model.

## Constraints

- Do not replace Slack or Telegram interactive sessions.
- Keep provider-specific code to authentication, trust/source normalization,
  and typed event emission.
- Workflows own task capture, answers, owner questions, retries, and no-op
  decisions.

## Done When

- Slack and Telegram adapters can emit `inbound.signal.received` for configured
  automation-worthy updates.
- Existing interactive chat and slash-command behavior remains covered by
  focused tests.
- Workflow dispatch from at least one chat-origin signal is covered by a test
  or rendered message fixture.

## Source / Intent

Follow-up from `task-define-inbound-channel-automation-as-typed-daemon-`.
The first slice proved the shared contract with GitHub and the generic webhook
route; Slack and Telegram remain important configured chat entry points.

## Initiative

Channel-driven automation.

## Acceptance Evidence

- Tests covering Slack and Telegram signal emission plus the unchanged chat
  session path.
- A rendered message fixture or transcript showing one chat-origin signal
  reaching workflow dispatch with project scope and trust metadata.
