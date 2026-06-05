---
id: task-add-dead-letter-queue-for-poisoned-events-and-batc
title: Add dead letter queue for poisoned events and batches
status: ready
priority: p1
area: core
summary: Add a scope-aware dead-letter queue for events, batches, and automation dispatches that repeatedly fail validation or execution, with redrive, diagnostics, and owner-visible controls.
depends_on: [task-add-durable-event-envelope-and-journal, task-add-generic-event-batching-to-workflow-triggers]
created_at: 2026-06-03T15:50:30.605Z
updated_at: 2026-06-05T22:41:22.543Z
---

## Problem

KOTA has workflow retry/backoff and failure records, but it does not have a
generic place to park poisoned events, poisoned batches, or automation dispatch
inputs that repeatedly fail validation or execution. A malformed provider
payload, bad workflow filter, unavailable credential, broken downstream tool,
or unsafe batch overflow can currently become a custom module warning, a failed
run, a retry loop, or a silent no-op depending on where it happens.

High-volume channel scenarios need a clear non-lossy failure state that
operators and reviewer agents can inspect and redrive after a fix.

## Desired Outcome

Add a scope-aware dead-letter queue for event and automation inputs. When an
event envelope, batch flush, or dispatch attempt fails after its configured
retry policy, the runtime records a dead-letter item with enough redacted
context to diagnose and retry it.

The DLQ should support:

- Item types for event envelope, batch envelope, workflow dispatch, and
  confirmed action dispatch.
- Failure reason, retry count, last error class, first/last failure time,
  source event ids, affected workflow names, and owning module.
- Redrive to original destination, redrive to simulation, dismiss, or export
  diagnostics.
- Client/API visibility with read/control capability separation.
- Metrics and progress-reviewer visibility.

## Constraints

- Do not create a second primary event queue or workflow scheduler. The DLQ is
  only the terminal/error state for existing event and workflow paths.
- Do not store raw secrets or unredacted sensitive payloads. Store references
  to event journal payloads and redacted projections where possible.
- Preserve scope isolation. Redrive in one scope must not replay into another.
- Do not auto-redrive endlessly. Redrive must create a new attempt with a new
  trace/causation link and an explicit operator/runtime reason.
- Define retention separately from source event retention so DLQ evidence does
  not disappear too early.

## Done When

- A typed DLQ store exists under `.kota/` or the runtime store subsystem.
- Workflow/event dispatch paths can move exhausted poisoned inputs to the DLQ.
- Daemon APIs and CLI/client surfaces can list, show, dismiss, and redrive DLQ
  items with capability-scoped controls.
- Tests cover validation failure, execution failure, max-attempt transition,
  batch item preservation, scope isolation, redacted projection, redrive, and
  dismissal.
- A fixture demonstrates a malformed Telegram-like inbound event moving to DLQ
  and then redriving successfully after the fixture schema is fixed.

## Source / Intent

Owner request on 2026-06-03 emphasized high-volume groups, staged processing,
generic batching, and progress reviewers that analyze logs/inputs/outputs.
That combination needs a reliable place to put poisoned work instead of losing
it or retrying forever.

Relevant local code:

- `src/core/workflow/trigger-types.ts`
- `src/core/workflow/step-executor-retry.ts`
- `src/core/workflow/run-store.ts`
- `src/modules/inbound-signals/events.ts`
- `src/core/daemon/event-ring-buffer.ts`

Research references:

- AWS SQS DLQs use a redrive policy and max receive count:
  `https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html`
- RabbitMQ dead-lettering parks messages rejected, expired, over limit, or over
  delivery limit: `https://www.rabbitmq.com/docs/dlx`

## Initiative

Recoverable automation failures: bad events and batches should be inspectable,
bounded, and redrivable rather than invisible or endlessly retried.

## Acceptance Evidence

- Unit and integration test output for DLQ write, query, redrive, and dismiss.
- CLI transcript showing a redacted DLQ item and a redrive action.
- Run artifact linking the original event id, failed workflow attempt, DLQ item,
  and redriven attempt.
