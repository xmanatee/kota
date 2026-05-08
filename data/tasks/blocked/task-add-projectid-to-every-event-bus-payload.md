---
id: task-add-projectid-to-every-event-bus-payload
title: Add projectId to every event-bus payload
status: blocked
priority: p2
area: architecture
summary: Add a typed projectId field (or envelope) to every daemon-emitted bus event payload so downstream consumers can route, scope, and persist by project.
created_at: 2026-05-08T00:57:06.459Z
updated_at: 2026-05-08T03:38:53.642Z
---

## Problem

The event bus (`src/core/events/event-bus.ts`) carries every interesting
runtime fact: workflow lifecycle, queue shape, approval transitions,
notification digests, channel inputs, owner questions. Today every payload
is implicitly scoped to "the daemon's one project". Once the daemon hosts
more than one project, every subscriber must be able to tell which project
each event belongs to without inferring from filename or content.

## Desired Outcome

Every daemon-emitted bus event carries a `projectId` (either as a typed
envelope wrapping the payload or as a required field on the typed payload —
the design owns the call). Subscribers receive a typed `(payload,
projectId)` shape. Cross-project filters are explicit at the subscription
boundary, never inferred.

The contributing module declarations stay typed: the existing
`defineModuleEvent<TPayload>(name, fields)` API is extended (or paired with
an envelope) so module-defined events automatically carry project scope
without each module restating it.

## Constraints

- Strict typed scope. No nullable `projectId?` for events that are
  project-scoped; no silent fall-through to a default project.
- Cross-project events (daemon-wide health, registry change) declare a
  distinct typed shape rather than reusing project-scoped events with a
  null sentinel.
- Existing module-event subscribers fail loudly during type-check if they
  ignore the new field; no permissive coercion at the boundary.
- This task does not change control-API routes or persistence formats —
  those changes land in the control-API follow-up. Only the in-process
  event payload shape and the in-process subscription typing change here.

## Done When

- `EventBus.emit` and `EventBus.subscribe` carry a typed `projectId` (or
  envelope) for every project-scoped event.
- `defineModuleEvent` signatures convey project scope in their type so
  cross-module subscribers see the field.
- Daemon-wide events (registry change, daemon lifecycle) use a distinct
  typed shape rather than a nullable `projectId`.
- All existing subscribers compile and pass tests against the new shape.
- A focused event-bus test asserts that two emits from two projects produce
  payloads with distinct `projectId` values, and that cross-project filters
  work as designed.

## Source / Intent

Decomposition slice 3 of the daemon foundation for multi-project
supervision (parent: `task-surface-project-selection-in-operator-clients-for-`,
foundation: `task-add-daemon-project-registry-and-projectid-attribut`).
Builds on the registry primitive and the per-project bundle factory.

Builder run `2026-05-08T03-28-53-940Z-builder-9wb0tj` measured the
repo-wide impact at 179 `emit` call sites across 53 source files plus
37 test files. Landing the change as a single sweep would either
break the build for hours or require introducing the explicitly-
forbidden nullable `projectId?` shim, so the run blocked the slice
for owner direction instead. A full decomposition proposal is
captured under
`.kota/runs/2026-05-08T03-28-53-940Z-builder-9wb0tj/decomposition-proposal.md`.
If the answer is "decompose", spawn the 3a (protocol primitives +
isolation test), 3b (core daemon + workflow-runtime emit sites), and
3c (module events + remaining production / test sweep) sub-tasks and
convert this task into a strategic anchor (`anchor: true`)
referencing them.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the same
daemon control contract.

## Acceptance Evidence

- A focused event-bus test asserting two-project emit/subscribe isolation
  through the typed payload shape.
- Type-check pass shows no nullable `projectId?` introduced into
  project-scoped event shapes.

## Unblock Precondition

```
kind: owner-decision
slot: 5b6c20dd
question: Should slice 3 be decomposed into 3a (protocol primitives + isolation test), 3b (core daemon + workflow-runtime emit sites), and 3c (module events + remaining production / test sweep), or pushed through as a single sweep?
context: Builder measured 179 emit call sites across 53 source files plus 37 test files; a single-sweep landing would break the build for hours or require the forbidden nullable projectId shim. Full proposal at .kota/runs/2026-05-08T03-28-53-940Z-builder-9wb0tj/decomposition-proposal.md.
proposed_answers: decompose, single-sweep, unblock
```
