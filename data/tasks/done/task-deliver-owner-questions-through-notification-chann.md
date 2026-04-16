---
id: task-deliver-owner-questions-through-notification-chann
title: Deliver owner questions through notification channels
status: done
priority: p1
area: modules
summary: Agents can enqueue owner questions but no channel surfaces them to the owner. Wire the owner.question.asked bus event into notification modules (Telegram, email, webhook, Slack) so escalations are seen asynchronously.
created_at: 2026-04-16T07:47:14.176Z
updated_at: 2026-04-16T08:45:35.703Z
---

## Problem

The `owner-questions` module enqueues structured questions from agents and
emits `owner.question.asked`, `owner.question.resolved`, `owner.question.dismissed`,
and `owner.question.expired` bus events (`src/core/events/event-bus-types.ts`).
Approvals already flow through Telegram, email, webhook, and Slack notification
modules — but no module subscribes to the owner-question bus events. As a
result, pending questions are only visible through the `kota owner-question`
CLI or the `/api/owner-questions` HTTP endpoint. An agent that blocks on an
owner question during an overnight autonomous run will not alert the owner,
defeating the core promise of the escalation mechanism.

## Desired Outcome

The notification pipeline treats owner questions as first-class delivery
events, consistent with how approvals are handled today:

- Telegram, email, webhook, and Slack notification modules subscribe to
  `owner.question.asked` (and optionally `owner.question.expired`) via
  `ModuleEventProxy.subscribe()` in their `onLoad` hooks.
- The rendered notification includes: question text, reason, source agent,
  and a deep link / instructions to answer or dismiss via the client or CLI.
- Per-channel filters respect the same quiet-hours, cooldown, and silencing
  config that approvals use — no new parallel config surface.
- Telegram delivery supports inline answer buttons consistent with inline
  approvals where feasible (defer inline interactivity to a follow-up if
  scope grows).
- Docs in `docs/NOTIFICATIONS.md` describe owner-question delivery wiring.

## Constraints

- Do not touch the core queue logic or the review gate — this is purely
  channel-side subscription and rendering.
- Reuse existing notification retry/quiet-hours helpers; do not re-implement
  delivery primitives per channel.
- Failing channels must not block the queue or the agent — delivery is
  best-effort and isolated per module.
- Keep inline interactive answering out of scope unless trivially achievable
  on one channel; file a follow-up for richer interactivity.

## Done When

- Each notification module (telegram, email, webhook, slack) delivers a
  message when `owner.question.asked` fires, gated by that channel's config.
- Tests cover the subscription path and the rendered message for at least two
  channels.
- `docs/NOTIFICATIONS.md` documents owner-question routing alongside approvals.
- An agent-triggered owner question surfaces through at least one real channel
  end-to-end without CLI polling.
