---
id: task-add-generic-event-batching-to-workflow-triggers
title: Add generic event batching to workflow triggers
status: done
priority: p1
area: core
summary: Add a durable, scope-aware batching primitive for any typed event stream so high-volume channels and periodic review workflows can buffer by count or time and emit one validated batch payload.
depends_on: [task-promote-projects-into-hierarchical-scopes]
created_at: 2026-06-03T13:40:14.237Z
updated_at: 2026-06-04T08:24:28.000Z
---

## Problem

High-volume sources such as Telegram groups, Slack channels, Gmail inboxes,
file watches, task changes, and run-completion events can trigger too many
individual workflow runs. The owner wants batching to be generic and usable for
any event stream, not a Telegram-only buffer. Today KOTA has event filters,
cooldowns, schedules, intervals, watch debounce, and workflow trigger chaining,
but it does not have a durable "buffer events until count or timeout, then emit
one batch payload" primitive.

Without a generic batching primitive, channel adapters will grow their own
buffers and staged processing will be inconsistent across providers.

## Desired Outcome

Add a scope-aware event batching primitive to the workflow runtime. A workflow
or automation can declare that a typed event stream should be buffered by event
name, scope, filter, grouping key, max count, max age, and optional idle
timeout. When the buffer flushes, KOTA emits one validated batch payload that
downstream steps can process through cheap-first and smart-before-write stages.

The primitive must support:

- Any typed bus event or module event.
- Scope-aware grouping and filtering.
- Durable buffer state across daemon restart.
- Flush by count, age, idle timeout, or explicit manual flush event.
- Batch payload schema including original event metadata and payloads.
- Backpressure/concurrency behavior that is visible in workflow run records.

## Constraints

- Do not implement batching inside Telegram, Slack, Gmail, or file-watch
  adapters except as callers of the generic primitive.
- Do not hide events from audit. Individual input events should still be
  inspectable through event/run artifacts even when the processing workflow
  receives a batch.
- Keep payload validation strict. If batched events are module-declared, the
  batch must preserve validated event payload shapes.
- Avoid unbounded memory. Buffers need durable size limits and explicit
  overflow behavior.
- Make staged processing a normal workflow composition: cheap classifier
  agent/code step first, stronger model or owner approval before non-read
  effects.

## Done When

- Workflow trigger schema supports a generic batch declaration or equivalent
  compiled primitive.
- The runtime persists batch buffers under `.kota/` and recovers them on
  daemon restart.
- A batch flush emits a typed payload containing scope id, source event name,
  grouping key, reason, count, time window, and input event envelopes.
- Tests cover count flush, timeout flush, restart recovery, scope isolation,
  filter validation, overflow handling, and downstream workflow execution.
- Example workflows demonstrate high-volume channel intake and task-count
  progress review without channel-specific buffering.

## Source / Intent

Owner follow-up on 2026-06-03: batching should be "a generic primitive" and
"kinda like workflow step which would batch things and emmit once buffer is
full or some timeout passess." The Telegram sports-community scenario and
general progress-reviewer scenario both need this.

Relevant current code: `src/core/workflow/trigger-types.ts`,
`src/core/workflow/validation-trigger.ts`, `src/core/workflow/runtime.ts`,
`src/core/workflow/schedule-triggers.ts`, `src/core/workflow/watch-triggers.ts`,
`src/core/events/event-bus.ts`, and `src/core/events/module-event.ts`.

Research reference: Node-RED message design uses explicit payload/topic fields
to preserve context through flows
(`https://nodered.org/docs/developing-flows/message-design`).

## Initiative

High-volume automation without provider-specific buffering: one batching
contract for channels, stores, schedules, watches, and autonomy telemetry.

## Acceptance Evidence

- Workflow runtime test output for batching and restart recovery.
- A committed example workflow or fixture that batches synthetic Telegram-like
  events and emits one batch payload.
- A run artifact showing a batch flush reason, grouped inputs, and downstream
  staged processing.

## Completion Evidence

- Runtime implementation and synthetic examples landed in `src/core/workflow/event-batches.ts`
  and `src/core/workflow/event-batches.test.ts`.
- Verified with focused workflow tests, workflow runtime/validation integration
  tests, typecheck, lint, and strict-types policy.
- Run artifact:
  `.kota/runs/2026-06-04T08-09-02-951Z-builder-njd2ly/batch-flush-artifact.json`.
