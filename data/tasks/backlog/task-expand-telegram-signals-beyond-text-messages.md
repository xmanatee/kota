---
id: task-expand-telegram-signals-beyond-text-messages
title: Expand Telegram signals beyond text messages
status: backlog
priority: p2
area: channel
summary: Extend the Telegram module from prefix text intake to typed message, reaction, membership, and presence-like signal events where the Bot API supports them, while preserving blocked-source emission and downstream workflow routing.
depends_on: [task-add-declarative-inbound-signal-routing-for-channel]
created_at: 2026-06-03T13:40:43.464Z
updated_at: 2026-06-03T13:41:17.000Z
---

## Problem

The Telegram module currently long-polls `message` updates and mostly handles
slash commands, project binding, interactive chat, voice transcription, and
prefix-configured text updates that emit `inbound.signal.received`. It does
not yet normalize richer Telegram update types such as reactions, membership
changes, edited messages, callback actions, or presence-like signals where the
Bot API exposes them.

The owner's Telegram scenarios need received messages and other signals to be
events with payloads, including blocked/archived source behavior and downstream
agent workflows for community availability tracking.

## Desired Outcome

Expand Telegram into a richer typed signal adapter after the shared inbound
routing protocol exists. The module should normalize supported Telegram update
types into provider-neutral inbound signal events plus Telegram-specific
extension fields where necessary.

The Telegram adapter should cover:

- Text, media-caption, voice/audio-transcribed, edited message, and deleted or
  retracted-message signals where feasible.
- Message reaction or callback/action signals where Bot API support is
  available.
- Membership/status changes for chats and actors where available.
- Source trust/status mapping including blocked/archived groups.
- Chat/source metadata needed by routing, batching, and audits.
- Redacted fixtures for high-volume group scenarios.

## Constraints

- Do not make Telegram own downstream routing. It emits normalized events and
  relies on the shared inbound dispatcher.
- Be precise about Bot API limits. If true online/presence state is not
  available to bots, document the unavailable signal rather than faking it.
- Preserve current slash commands, interactive chat behavior, `/project`
  binding, owner-question replies, and schedule reminders.
- Keep payloads bounded and redacted. Do not store raw credentials or private
  media in committed fixtures.
- Use rendered message fixtures or conversation screenshots as channel
  evidence where user-facing behavior changes.

## Done When

- Telegram polling/webhook setup requests the supported update types needed by
  the task.
- Each supported update type is normalized into `inbound.signal.received` or a
  typed companion event with payload validation.
- Blocked/archived Telegram group behavior emits an auditable blocked event
  and does not start processing workflows through the dispatcher.
- Tests cover text, reaction/action, membership/status where available, edited
  message, unsupported presence handling, and blocked source handling.
- A redacted fixture demonstrates the padel/badminton/tennis community intake
  shape expected by the dispatcher and batching workflow.

## Source / Intent

Owner request from `data/inbox/many.md`: Telegram should treat received
messages and other signals such as reactions and online state as events. The
sports-community scenarios need reliable Telegram group intake before routing,
batching, classification, owner confirmation, and booking actions can be built.

Relevant current code: `src/modules/telegram/index.ts`,
`src/modules/telegram/bot.ts`, `src/modules/telegram/inbound-signal.ts`, and
`src/modules/telegram/AGENTS.md`.

## Initiative

Telegram as a typed channel adapter: Telegram-specific details are normalized
once, then KOTA's generic routing and automation machinery handles the work.

## Acceptance Evidence

- Telegram module test output covering every supported signal type and the
  unsupported-presence branch.
- Rendered Telegram message/update fixtures checked in with tests, including a
  blocked group and a high-volume community sample.
- A daemon run artifact showing normalized Telegram events delivered to the
  inbound routing dispatcher.
