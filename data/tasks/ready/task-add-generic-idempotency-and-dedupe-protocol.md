---
id: task-add-generic-idempotency-and-dedupe-protocol
title: Add generic idempotency and dedupe protocol
status: ready
priority: p1
area: core
summary: Add a reusable idempotency-key and dedupe-result contract for event ingestion, workflow dispatch, owner-confirmed actions, and provider writes so retries cannot duplicate consequential work.
depends_on: [task-add-durable-event-envelope-and-journal, task-add-persisted-owner-confirmed-action-protocol]
created_at: 2026-06-03T15:50:20.481Z
updated_at: 2026-06-05T22:41:22.517Z
---

## Problem

KOTA receives and emits many signals that can repeat: Telegram and Slack
message updates, Gmail notifications, webhooks, file watches, workflow retries,
owner confirmations, and external provider write attempts. Some current
payloads carry provider-local ids such as `externalId`, but there is no generic
idempotency key, dedupe store, or result replay contract across event ingestion,
workflow dispatch, and consequential actions.

Without this, a daemon restart, webhook retry, manual replay, or double owner
click can create duplicate tasks, duplicate owner decisions, repeated booking
attempts, repeated message reactions, repeated emails, or duplicate workflow
runs.

## Desired Outcome

Add a generic idempotency and dedupe protocol. Producers and action executors
should declare an idempotency key derived from stable event/provider/action
identity. The runtime stores the first accepted result for that key, rejects or
replays equivalent duplicates, and reports parameter mismatches as explicit
errors.

The protocol should cover:

- Event ingestion dedupe for channel/webhook/provider events.
- Workflow dispatch dedupe for event-triggered and batch-triggered runs.
- Owner decision consumption dedupe so a confirmation can authorize one
  action exactly once unless explicitly configured otherwise.
- Provider write dedupe for tools/actions that can safely retry.
- Explicit key scope, retention, parameter fingerprint, result projection, and
  conflict status.

## Constraints

- Do not hide duplicates by silently dropping them. Store and expose whether an
  event/action was accepted, replayed, ignored, expired, or rejected due to
  mismatched parameters.
- Do not use sensitive data such as email addresses, message text, or personal
  identifiers as raw idempotency keys.
- Do not apply idempotency keys to read-only operations unless a caller needs
  dedupe telemetry; reads are already non-mutating.
- Keep provider-specific external ids module-owned. Core owns the key/result
  protocol and storage contract.
- Tie idempotency entries to scope and retention policy so one scope cannot
  suppress another scope's work.

## Done When

- A typed idempotency store exists with key, scope, operation type, parameter
  fingerprint, first result, status, created/updated timestamps, and retention.
- Event ingestion adapters can attach or derive idempotency keys from durable
  event envelopes.
- Workflow dispatch checks keys before queueing duplicate event/batch runs.
- Confirmed actions can consume an owner decision once and expose duplicate
  consumption as a typed result.
- Tests cover accepted first request, exact duplicate result replay, parameter
  mismatch rejection, retention expiry, scope isolation, concurrent duplicate
  race, and provider-write retry.

## Source / Intent

Owner scenarios on 2026-06-03 include high-volume Telegram groups, staged
processing, owner confirmation, and provider-specific booking through a website
or Telegram reaction. Those scenarios need retry safety and dedupe as a generic
primitive rather than per-channel heuristics.

Relevant local code:

- `src/modules/inbound-signals/events.ts`
- `src/core/workflow/runtime-dispatch.ts`
- `src/core/daemon/owner-question-queue.ts`
- `src/core/daemon/approval-queue.ts`
- `src/core/tools/tool-runner.ts`

Research reference: Stripe's idempotency model stores the first result for a
key and rejects mismatched parameter reuse:
`https://docs.stripe.com/api/idempotent_requests`

## Initiative

Exactly-once posture for consequential automation: retries and duplicate
signals should not duplicate owner-visible work or external side effects.

## Acceptance Evidence

- Unit tests for idempotency store state transitions and conflict handling.
- Integration test where the same inbound signal is delivered twice but queues
  one workflow run and records one duplicate result.
- Run artifact showing a confirmed action consumed once and a second attempt
  rejected or replayed with the stored result.
