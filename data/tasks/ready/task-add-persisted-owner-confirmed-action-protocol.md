---
id: task-add-persisted-owner-confirmed-action-protocol
title: Add persisted owner confirmed action protocol
status: ready
priority: p1
area: core
summary: Add a structured owner-decision and external-action protocol so workflows can persist choices, request confirmation, and execute provider-specific side effects only after the required approval.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-module-setup-and-auth-requirement-protocol]
created_at: 2026-06-03T14:01:17.340Z
updated_at: 2026-06-04T17:13:04.035Z
---

## Problem

KOTA has owner-question and approval queues, but the original request includes
a broader pattern: an agent proposes options, the owner chooses or confirms one,
KOTA persists that decision, and a later workflow step performs a
provider-specific side effect such as booking through a website, reacting to a
Telegram message, sending a Gmail reply, or applying an architecture choice.

The existing protocol pieces are close, but there is no single documented and
typed owner-decision/action contract for "ask, persist, resume, act" across
clients and modules.

## Desired Outcome

Add a persisted owner-confirmed action protocol that workflows and modules can
use when a non-read side effect depends on owner choice. The protocol should
combine owner prompts, structured options, persisted decision records,
expiration/cancellation, approval semantics, and provider-specific action
execution under one auditable contract.

It should support:

- Single-choice, multi-choice, free-text, and structured form decisions.
- Persistent decision records with scope, requester, evidence, options,
  selected value, expiration, and consuming workflow/run id.
- Non-persisted setup prompts remaining separate from persisted owner
  decisions.
- Resume semantics for workflows waiting on decisions.
- Action adapters for provider-specific side effects, with explicit dry-run,
  requires-confirmation, and dangerous-effect metadata.
- Client rendering through the shared UI contribution protocol when available.

## Constraints

- Do not expose raw secrets or credentials in decision records.
- Do not let agents perform external writes directly after asking in prose.
  Side effects must go through typed action adapters or tools with guardrails.
- Do not create a second approval queue unless existing owner-question and
  approval queues cannot represent the state. Prefer extending or composing the
  existing queues.
- Persist only decisions that matter after the current session/run. Setup
  prompts with no durable choice belong to the setup/auth protocol.
- Keep provider-specific action details module-owned; core owns the decision
  record and workflow resume contract.

## Done When

- A typed owner decision record exists with validation, persistence, and daemon
  control API projection.
- Workflows can ask for a decision, suspend, resume when answered, and consume
  the selected option through structured output.
- A confirmed action step can execute a provider-specific side effect only when
  the decision record authorizes it.
- Tests cover decision creation, expiration, cancellation, resume, duplicate
  consumption rejection, approval/owner-question integration, and redacted
  client projection.
- At least one fixture demonstrates a choice that only persists data and one
  fixture demonstrates a confirmed external action.

## Source / Intent

Owner request from `data/inbox/many.md`: "there should be persisted (e.g. some
actions like confirming proposed architecture or choosing specific option
proposed by a trip planner) and non-persisted data..." and the channel scenario
where KOTA asks whether to sign up and then books/replies/reacts only after
confirmation.

Relevant existing surfaces include owner questions, approvals, workflow
`await-event` steps, tool effect metadata, and module/channel tools.

## Initiative

Auditable owner-controlled side effects: KOTA can remember decisions and act on
them safely without turning confirmations into informal chat text.

## Acceptance Evidence

- Unit/integration tests for decision persistence and workflow resume.
- A run artifact showing a persisted decision consumed by a later confirmed
  action step.
- CLI transcript or rendered client fixture showing pending, answered,
  expired, and consumed decision states with secrets redacted.
