---
id: task-add-social-platform-inbound-signal-adapters
title: Add social platform inbound-signal adapters
status: backlog
priority: p3
area: modules
summary: Define the X/social provider adapter path into inbound.signal.received when a social connector is configured.
created_at: 2026-05-25T02:48:53.898Z
updated_at: 2026-05-25T02:48:53.898Z
---

## Problem

The owner request included X/social platform signals as potential daemon entry
points, but KOTA has no provider-specific social adapter mapped into the shared
inbound automation contract.

## Desired Outcome

When a social connector is configured, supported social mentions, direct
messages, or webhook-style deliveries normalize into `inbound.signal.received`
with project scope, provider/account identity, actor trust, source id,
timestamp, and bounded message/action content.

## Constraints

- Do not add a social-platform planner inside the adapter.
- If no social connector exists yet, define the module boundary and blocked
  capability honestly rather than fabricating runtime behavior.
- Treat social-authored text as untrusted source material for consuming
  workflows.

## Done When

- A social provider adapter exists or the task is rescheduled/blocked with the
  exact missing connector capability.
- The adapter emits the shared typed signal for at least one configured social
  signal shape.
- Tests cover validation and workflow dispatch/no-op from a social-origin
  signal.

## Source / Intent

Follow-up from `task-define-inbound-channel-automation-as-typed-daemon-`.
The owner request named X/social alongside Telegram, Gmail/email, Calendar, and
other external channels.

## Initiative

Channel-driven automation.

## Acceptance Evidence

- Tests or a blocked-task precondition proving the social connector state is
  handled honestly.
- Transcript or fixture showing one social-origin signal reaching workflow
  dispatch with project scope and trust metadata when the connector exists.
