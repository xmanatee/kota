---
id: task-type-module-event-contributions
title: Type module event contributions
status: done
priority: p1
area: architecture
summary: Give modules a typed event declaration and subscription protocol so event names and payloads are enforced instead of flowing through string plus Record<string, unknown>.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-29T05:38:55.876Z
---

## Problem

The core event bus has a typed `BusEvents` map, but modules receive
`ctx.events.emit(event: string, payload: Record<string, unknown>)` and
`subscribe(event: string, handler: ...)`. That means module event names and
payloads become stringly at the exact boundary where cross-module protocols
need the most discipline.

This also makes event-driven workflow triggers vulnerable to drift: a module
can emit a custom event whose payload does not match the workflow filter or
consumer assumptions, and TypeScript will not help.

## Desired Outcome

Modules can declare event contributions and consume typed events:

- Known core events stay in the core event catalog.
- Module-owned events are declared by the owning module with a namespaced event
  id and payload type or schema.
- `ctx.events.emit` and `ctx.events.subscribe` are typed against the declared
  event catalog available to that module.
- Workflow triggers that listen to module events can validate the event name
  and filter fields against the declared payload shape.
- Generic inbound webhook/event surfaces retain an explicit untyped boundary
  and must validate before emitting typed events.

## Constraints

- Do not require every transient operator-facing notification to become durable
  storage. This task is about type contracts, not persistence.
- Preserve the ability to listen to wildcard events for tracing/metrics, but
  keep wildcard payloads explicitly envelope-shaped.
- Do not duplicate event catalogs in docs. Source types and focused tests are
  the contract.
- Keep escape hatches for truly external custom events narrow and visibly
  unsafe.

## Done When

- Module event declarations exist and are consumed by at least two existing
  module-owned event streams.
- `ModuleEventProxy` no longer exposes raw `string` + `Record<string, unknown>`
  as the normal module path.
- Workflow validation catches a trigger/filter that references a nonexistent
  typed event field.
- Tests cover a producer, subscriber, and workflow trigger using the same typed
  module event declaration.

## Source / Intent

Investigation evidence:

- `src/core/events/event-bus-types.ts` defines typed core `BusEvents`.
- `src/core/events/event-bus.ts` preserves typed overloads internally but also
  allows custom strings.
- `src/core/modules/module-types.ts` exposes a raw string/unknown module event
  proxy.
- `src/core/workflow/AGENTS.md` already says workflows should use semantic bus
  events over workflow-name routing; this task makes that rule enforceable.

External comparison:

- LangGraph and CrewAI both emphasize event/state flow as a core workflow
  concept; KOTA should keep its event model typed rather than prompt-policed.

## Initiative

Typed event architecture: make cross-module workflow handoffs compile-time and
validation-time contracts instead of conventions.

## Acceptance Evidence

- Typecheck or fixture failure for emitting a typed event with the wrong
  payload shape.
- Workflow validation fixture failure for an invalid typed-event filter.
- Existing workflow/event tests pass after migration.

