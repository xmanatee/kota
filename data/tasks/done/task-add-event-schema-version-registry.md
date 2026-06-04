---
id: task-add-event-schema-version-registry
title: Add event schema version registry
status: done
priority: p1
area: core
summary: Extend module event declarations into a strict schema and compatibility registry so payloads, filters, batches, simulations, and clients can validate event shapes by name and version.
depends_on: [task-promote-projects-into-hierarchical-scopes]
created_at: 2026-06-03T15:50:11.437Z
updated_at: 2026-06-04T20:14:40.130Z
---

## Problem

KOTA module events are typed in TypeScript and registered with a runtime field
list, but the runtime contract stops at flat field names. Workflow trigger
validation can reject filters for fields that are not declared, but it cannot
validate payload shape, nested data, version compatibility, examples, redaction
classification, or the payload shape of a batch/event replay/client detail
view.

This is too weak for channel-heavy automation. Telegram, Slack, Gmail,
Calendar, code hooks, workflow emits, and owner-confirmed actions all need
event payloads that clients and workflows can inspect without relying on prose
or module-private assumptions.

## Desired Outcome

Extend the module event registry into a strict event schema registry. Each
module-owned event declaration should expose a stable event name, owner module,
scope kind, current schema version, payload schema, filterable fields, examples,
compatibility policy, data sensitivity classification, and an optional
normalizer for external adapter input.

The registry should support:

- Runtime validation of emitted payloads at the module/core boundary.
- Filter validation against schema paths, not just top-level field names.
- Versioned schema references for event envelopes, batches, journals, dry-run
  samples, and client projections.
- A compatibility check for schema changes that would break existing workflow
  filters, batch declarations, simulations, or rendered client views.
- Daemon read APIs for clients to inspect event contracts without importing
  module code.

## Constraints

- Do not add a second event declaration mechanism beside `ModuleEventDef`.
  Strengthen it or wrap it with a strict typed schema helper.
- Keep module ownership clear. Core validates the declaration protocol; modules
  own their event names and payload semantics.
- Do not silently coerce malformed internal payloads. External adapters may
  normalize once at the boundary and then emit a validated event.
- Keep event data classification separate from credential storage. Schema
  metadata can say a field is sensitive, but secret values must still live in
  the secrets/setup protocol.
- Preserve the current "unknown external event" escape hatch as visibly unsafe
  and require boundary validation before routing it into normal automation.

## Done When

- `ModuleEventDef` or a successor helper carries a strict runtime schema,
  schema version, filterable path metadata, and sensitivity metadata.
- The module loader registers schemas, rejects duplicate event ownership, and
  rejects incompatible redeclarations in one process.
- Workflow trigger validation can validate nested filter paths and reports
  schema-version errors clearly.
- Event emit paths validate payloads for module-owned events and fail loudly on
  malformed internal data.
- Daemon APIs expose event schema summaries and full event schema detail for
  clients and simulation tools.
- Tests cover schema registration, duplicate ownership, invalid payload emit,
  nested filter validation, incompatible schema evolution, and daemon API
  projection.

## Source / Intent

Owner architecture review request on 2026-06-03: "events should support
payloads" and the event dispatcher should be configurable enough for channel
events, code-hook results, linter results, Telegram message payloads, and
staged processing. The local investigation found `src/core/events/module-event.ts`
currently records event name, owner module, scope, and flat fields only.

Relevant local code:

- `src/core/events/module-event.ts`
- `src/core/events/event-bus.ts`
- `src/core/workflow/validation-trigger.ts`
- `src/modules/inbound-signals/events.ts`

Research references:

- AsyncAPI describes channels whose messages must validate against one message
  object: `https://www.asyncapi.com/docs/reference/specification/v3.0.0`
- Confluent Schema Registry documents schema versioning and compatibility
  policies: `https://docs.confluent.io/platform/7.7/schema-registry/fundamentals/schema-evolution.html`

## Initiative

Verifiable event contracts: every event KOTA routes, batches, journals, or
renders should have a clear owner and machine-checkable payload contract.

## Acceptance Evidence

- Typecheck and unit test output for event schema registration and validation.
- Workflow validation tests showing nested filter acceptance/rejection against
  registered schema paths.
- Daemon API fixture showing event schema summaries and one full schema detail.
- A failing test or fixture proving incompatible schema changes are rejected
  before runtime dispatch.
