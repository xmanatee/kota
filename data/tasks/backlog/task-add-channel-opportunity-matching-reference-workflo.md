---
id: task-add-channel-opportunity-matching-reference-workflo
title: Add channel opportunity matching reference workflow
status: backlog
priority: p2
area: channel
summary: Build a reference workflow for high-volume community messages that batches opportunities, classifies them cheaply, checks calendar availability, asks the owner, and performs a confirmed provider-specific action.
depends_on: [task-add-declarative-inbound-signal-routing-for-channel, task-add-generic-event-batching-to-workflow-triggers, task-add-module-setup-and-auth-requirement-protocol, task-add-persisted-owner-confirmed-action-protocol]
created_at: 2026-06-03T14:01:23.477Z
updated_at: 2026-06-03T14:01:29.000Z
---

## Problem

The architecture/protocol tasks cover inbound routing, batching, auth/setup,
and owner-confirmed actions, but the original request included a concrete
channel workflow: high-volume sports community messages should be scanned for
available game spots, checked against the owner's calendar, escalated for
confirmation only when useful, and then booked through the correct
provider-specific action.

Without a reference workflow, the generic primitives may ship without proving
they compose into the real Telegram/padel/badminton/tennis scenario.

## Desired Outcome

Build a provider-neutral reference workflow for channel opportunity matching,
with Telegram sports communities as the primary fixture. The workflow should
consume routed inbound signals, batch high-volume messages, run cheap-first
classification, enrich likely opportunities, check calendar availability,
ask the owner, and execute a confirmed action through a module-specific adapter
such as website booking, Telegram reaction/reply, or another channel action.

The workflow should demonstrate:

- Source routing for specific communities/chats/channels.
- Blocked/archived source no-op behavior.
- Batch processing by count or timeout.
- Staged model/tool use: cheap classifier first, stronger model before asking
  or writing.
- Calendar availability lookup through configured calendar tools.
- Persisted owner decision and confirmed action execution.
- Provider-specific action selection without hardcoding it into the core.

## Constraints

- Keep this as a reference workflow and fixtures, not a hardcoded sports-only
  core feature.
- Do not perform real bookings or send real messages in tests. Use fake
  provider adapters, dry-run tools, or redacted fixtures.
- Do not ask the owner for every noisy message. Only classified, calendar-fit
  opportunities should create pending decisions.
- Use the module setup/auth protocol for calendar and provider credentials.
- Use generic routing and batching primitives; do not implement separate
  Telegram-specific buffering.
- Preserve privacy in fixtures by redacting group names, actor ids, and exact
  schedule details where needed.

## Done When

- A reference workflow or fixture exists for channel opportunity matching.
- It processes a high-volume Telegram-like batch, ignores blocked sources,
  filters non-opportunities cheaply, checks calendar availability, and creates
  an owner decision only for plausible matches.
- A confirmed decision executes a fake provider-specific booking/reaction
  action through the owner-confirmed action protocol.
- Tests cover no-op batch, blocked source, cheap classifier rejection, calendar
  conflict, owner decline, owner accept, and provider action failure.
- The workflow docs explain how the same pattern applies to Slack, Gmail, or
  other channel/community sources.

## Source / Intent

Owner request from `data/inbox/many.md`: Telegram module connected to padel,
badminton, and tennis communities should track available spots, compare them
against the owner's schedule, ask whether to sign up, and proceed differently
depending on the community, such as website booking or Telegram reaction.

## Initiative

Composable channel automation: prove the generic event, routing, batching,
calendar, owner-decision, and action protocols work together in a realistic
high-volume channel workflow.

## Acceptance Evidence

- Workflow test output covering all required branches.
- Redacted high-volume channel fixture and expected structured outputs.
- Run artifact under `.kota/runs/<run-id>/` showing batch input, staged
  classification, calendar check, owner decision, and dry-run provider action.
- Rendered Telegram or CLI fixture showing the owner confirmation prompt and
  accepted/declined outcomes.
