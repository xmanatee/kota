---
id: task-add-durable-event-envelope-and-journal
title: Add durable event envelope and journal
status: ready
priority: p1
area: core
summary: Introduce a durable event envelope and append-only event journal so module events, workflow triggers, channel signals, and daemon events carry stable identity, causality, scope, schema, and replay metadata beyond the in-memory bus.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-add-event-schema-version-registry]
created_at: 2026-06-03T15:50:03.360Z
updated_at: 2026-06-05T18:23:08.568Z
---

## Problem

KOTA events currently move through a synchronous in-process `EventBus`.
The daemon also keeps a fixed-size in-memory SSE ring buffer for recent
operator events. That is enough for live coordination, but it is not enough for
high-volume channels, replay, batching, DLQs, durable owner decisions,
cross-client catch-up, audit, or progress reviewers that need to understand
what happened after a daemon restart.

The current event payloads also do not carry one common envelope with event
identity, source identity, scope, schema version, causality, trace context,
idempotency, received time, and redaction/provenance metadata.

## Desired Outcome

Add a durable `EventEnvelope` and append-only event journal that wraps every
module-owned event, workflow trigger event, channel signal, and daemon event
that needs replay or audit. The envelope should be the one common place for
event metadata; payload shape remains owned by the event schema registry.

The envelope should include stable fields for:

- Event id and source identity.
- Event type/name and schema version.
- Scope id and parent scope lineage.
- Occurred/received/emitted timestamps.
- Producer module/channel/tool/workflow/run identity.
- Correlation id, causation id, parent event id, and trace context.
- Idempotency key and external provider id where available.
- Data classification/redaction profile.
- Payload pointer or inline payload, depending on retention policy.

The journal should support append, query by type/scope/time/id/source, resume
from cursor, and replay into simulation or workflow dispatch without becoming a
second workflow run store.

## Constraints

- Do not replace the in-process event bus. Keep it as the live fan-out
  mechanism and add durable journaling at the runtime boundary.
- Do not duplicate workflow run logs. The journal records event occurrence and
  causality; run stores continue to own step execution evidence.
- Do not put raw credentials, unredacted secrets, or full sensitive provider
  payloads into client-visible projections.
- Avoid unbounded storage. The journal must have retention hooks and explicit
  behavior when retention expires.
- Use the scope abstraction, not typed project categories.
- Keep journal writes strict and observable. Failed journal writes for events
  marked durable must surface as runtime errors or degraded health, not silent
  drops.

## Done When

- A typed `EventEnvelope` exists and is used by durable event emission paths.
- The daemon writes an append-only event journal under `.kota/` or a typed store
  boundary and recovers its cursor after restart.
- `/api/events` or a successor route can query durable events without relying
  only on the in-memory ring buffer.
- Workflow dispatch, batching, owner questions/approvals, and inbound signals
  can reference event ids instead of copying ad hoc metadata.
- Tests cover event identity uniqueness, scope filtering, restart persistence,
  causation links, trace context propagation, redacted client projection, and
  replay into a simulation/dry-run path.

## Source / Intent

Owner architecture review request on 2026-06-03 asked for events with payloads,
scheduled events, channel signals, code-hook results, batching, staged
processing, and progress review across logs/inputs/outputs/recent changes. The
local investigation found:

- `src/core/events/event-bus.ts` is explicitly ephemeral with no persistence or
  replay.
- `src/core/daemon/event-ring-buffer.ts` is in-memory and overwrites old
  events.
- `src/modules/inbound-signals/events.ts` has provider/source/external ids but
  no generic event envelope or durable dedupe identity.

Research references:

- CloudEvents defines common event metadata and says `source` plus `id` should
  identify duplicate events: `https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md`
- Temporal's event history model shows why durable event history is useful for
  recovery and audit: `https://docs.temporal.io/workflow-execution/event`
- W3C Trace Context and OpenTelemetry context propagation define a standard
  way to carry causal trace ids across boundaries:
  `https://www.w3.org/TR/trace-context/` and
  `https://opentelemetry.io/docs/concepts/context-propagation/`

## Initiative

Durable event substrate: one event record shape for channels, schedules,
hooks, workflows, clients, auditing, batching, simulation, and review.

## Acceptance Evidence

- Unit and integration test output for durable event append/query/restart.
- A committed fixture showing a Telegram-like inbound signal envelope with
  scope, schema version, source id, idempotency key, causation id, and redacted
  client projection.
- A daemon API transcript showing durable event query still works after a
  simulated daemon restart.
