---
id: task-add-declarative-inbound-signal-routing-for-channel
title: Add declarative inbound signal routing for channels
status: backlog
priority: p1
area: channel
summary: Add a provider-neutral routing table for inbound channel events so Telegram, Slack, Gmail, and future adapters map sources to scopes, workflows, agents, trust states, and blocked/audit behavior consistently.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-generic-event-batching-to-workflow-triggers]
created_at: 2026-06-03T13:40:37.844Z
updated_at: 2026-06-03T14:08:54.000Z
---

## Problem

KOTA has a provider-neutral `inbound.signal.received` event and Telegram,
Slack, and Google Workspace adapters can emit normalized signals. Routing is
still mostly adapter-specific: Telegram prefix rules decide when to emit,
trust lists live per channel, Gmail has module-specific inbound routes, and
there is no single declarative dispatcher that maps provider/source/chat/group
signals to scopes, workflows, agents, batching, and blocked-source behavior.

The owner wants channel events such as Telegram messages, reactions, online
state, Gmail messages, and Slack messages to be events with payloads, and wants
the dispatcher configurable so specific chats/groups/channels can be processed
by specific agents or workflows.

## Desired Outcome

Add a provider-neutral inbound signal routing protocol. Adapters authenticate
and normalize external inputs, attach source metadata/trust, and emit typed
events. A central dispatcher evaluates declarative routing rules and starts
the appropriate workflow/automation with typed payloads.

The routing protocol should support:

- Provider, account, channel/source id, actor trust, source status, and scope.
- Explicit `blocked` or archived/ignored sources that still emit auditable
  blocked events but do not start processing workflows.
- Mapping sources to scopes and one or more workflow/automation targets.
- Optional batching policy by rule.
- Staged processing policy by rule, including cheap classifier before stronger
  model or non-read action.
- Deterministic rule validation and conflict detection.
- Operator-visible routing status in clients.

## Constraints

- Do not make Telegram, Slack, Gmail, or future channel modules own routing
  semantics beyond normalization and source-specific authentication.
- Preserve provider-specific payload details only inside typed extension fields
  or linked artifacts; common routing fields must stay provider-neutral.
- Blocked events should be emitted for auditability, but dispatcher rules must
  prevent downstream processing unless a rule explicitly opts into blocked
  audit handling.
- Routing rules must be validated against declared event fields and known
  workflow/automation ids where possible.
- Avoid prompt-only routing. Agents can classify content after routing, but
  which sources are eligible must be a typed config/protocol decision.

## Done When

- A typed inbound routing config/protocol exists with validation and docs.
- Telegram, Slack, and Google Workspace inbound paths use the shared dispatcher
  instead of each owning downstream routing decisions.
- Blocked/archived source behavior is covered by tests: event emitted,
  dispatcher records no processing workflow, audit/status visible.
- A configured source can route to a workflow/automation with a scoped payload.
- A route can attach a batching policy without provider-specific buffering.
- Clients can list inbound routes and source trust/status through a shared
  daemon contract.

## Source / Intent

Owner request from `data/inbox/many.md` and follow-up on 2026-06-03: archived
or ignored sources can be emitted as blocked events; batching should be
generic; Telegram/Gmail/Slack/etc. should route external signals through events
and configurable dispatch.

Relevant current code: `src/modules/inbound-signals/`,
`src/modules/telegram/inbound-signal.ts`, `src/modules/slack-channel/inbound-signal.ts`,
`src/modules/google-workspace/index.ts`, `src/core/events/module-event.ts`, and
`src/core/workflow/validation-trigger.ts`.

Research reference: Node-RED message design keeps payload plus contextual
message fields flowing through nodes
(`https://nodered.org/docs/developing-flows/message-design`).

## Initiative

Channel intake as typed event routing: external messages become auditable,
scope-aware KOTA events before any agent or side effect runs.

## Acceptance Evidence

- Unit/integration tests for route validation, blocked source behavior,
  workflow dispatch, and batch-policy attachment.
- Rendered Telegram or Slack message fixture showing a blocked-source event is
  recorded but not processed.
- CLI transcript or web screenshot under `.kota/runs/<run-id>/` listing
  inbound routes and source statuses.
