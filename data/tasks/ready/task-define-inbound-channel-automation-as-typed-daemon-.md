---
id: task-define-inbound-channel-automation-as-typed-daemon-
title: Define inbound channel automation as typed daemon events
status: ready
priority: p2
area: architecture
summary: Unify external message, email, calendar, Telegram, Slack, X/social, and webhook signals behind a thin per-channel adapter contract that emits typed daemon events for bounded workflows.
created_at: 2026-05-25T01:27:33.030Z
updated_at: 2026-05-25T02:34:39Z
---

## Problem

Owner wants configured external channels to act as daemon entry points for
bounded automation, not only as notification sinks or interactive chat
sessions. Current reality is mixed:

- Telegram and Slack are bidirectional chat channels with slash commands and
  interactive sessions.
- Email is outbound-notification focused.
- Google Workspace exposes Gmail, Calendar, and Drive as agent tools, but does
  not contribute inbound Gmail or calendar signal events.
- GitHub webhook intake normalizes GitHub events and has specialized mention
  workflows.
- The webhook module exposes generic inbound HTTP-to-bus and signed workflow
  trigger routes, but that is not a shared channel signal contract with
  sender/account trust, project scoping, and normalized intent metadata.

Without one typed inbound-signal contract, new providers are likely to grow
bespoke planners, task classifiers, calendar logic, or agent loops inside each
channel module.

## Desired Outcome

A configured inbound message, email, calendar event, Telegram/Slack update,
X/social signal, webhook delivery, or similar external signal can trigger a
bounded daemon workflow through one typed event shape or small family of typed
event shapes. Channel modules stay thin: authenticate, normalize, enforce
sender/chat/account trust, attach project scope, and emit the event. Workflows
own task capture/update, memory or knowledge capture, answer/reply, calendar
action, owner-question escalation, approval posture, retry, audit, and no-op
decisions.

## Constraints

- Do not replace the existing `channel` protocol or interactive session model.
  Inbound automation is a workflow trigger path, not a second session runtime.
- Do not build provider-specific automation planners inside Telegram, Slack,
  email, Google Workspace, X/social, or webhook modules.
- Use typed module event declarations, not raw string event names, when the
  payload shape is known at build time.
- Preserve project scoping, actor/sender trust, auditability, retries, and
  autonomy/approval posture at the daemon/workflow boundary.
- Owner-question paths stay first-class: automation that needs owner input must
  use the waiting workflow recipe and resume from the resolved answer.
- The first slice may prove the contract with a small number of adapters and
  tests, but the design must name how the remaining configured channels map
  into the same contract.

## Done When

- A typed inbound-signal contract exists in code with validation for project
  scope, provider/channel identity, actor trust, source id, timestamp, and the
  normalized user-visible content or action payload.
- At least one existing provider-specific inbound path and one generic/ad-hoc
  path use the contract without duplicating planner logic in the channel
  module.
- A focused workflow test proves a normalized inbound signal can create/update
  a task, ask the owner and resume, or explicitly no-op through normal workflow
  dispatch.
- Local `AGENTS.md` guidance for affected modules describes the boundary:
  adapters authenticate and emit; workflows decide.
- Follow-up tasks exist for any important platform adapters that are not
  implemented in the first slice.

## Source / Intent

Owner inbox capture
`data/inbox/task-assess-inbound-channel-automation-architecture.md` asked KOTA
to assess Telegram, Gmail/email, Calendar, X/social, and other platforms as
configured daemon entry points for bounded automation. The capture explicitly
preferred one simple typed inbound-event contract plus per-channel adapters
over bespoke automation paths per platform.

## Initiative

Channel-driven automation: external platform signals should enter KOTA through
the daemon's typed workflow/event model while keeping channel modules thin.

## Acceptance Evidence

- Tests covering event validation, at least two adapter paths, and workflow
  dispatch from a normalized inbound signal.
- A runtime probe or transcript under `.kota/runs/<run-id>/inbound-signals/`
  showing a sample inbound payload reaching the daemon workflow queue with
  project scope and trust metadata intact.
