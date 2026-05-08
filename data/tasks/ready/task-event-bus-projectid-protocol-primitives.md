---
id: task-event-bus-projectid-protocol-primitives
title: Add event-bus projectId protocol primitives
status: ready
priority: p2
area: architecture
summary: Establish the typed event-bus project scope primitive and a focused two-project isolation test before sweeping every emitter.
created_at: 2026-05-08T16:30:00.000Z
updated_at: 2026-05-08T16:30:00.000Z
---

## Problem

The multi-project daemon now has a project registry and per-project runtime
bundles, but the event bus still carries implicitly single-project payloads.
The full sweep touches 179 emit call sites, so the first safe slice is the
protocol primitive itself: event scope shape, subscribe/filter semantics, and a
small isolation test that proves two project-scoped events cannot be confused.

## Desired Outcome

Introduce the typed project scope surface for daemon events without migrating
every production emitter in the same change. The primitive should make the
target shape obvious and strict enough that later slices are mechanical.

## Constraints

- No nullable `projectId?` shim for project-scoped events.
- Daemon-wide events must use a distinct explicit shape, not a null sentinel.
- Do not sweep module emit sites in this task; that is the third slice.
- Keep the primitive source-owned and testable. Do not encode the contract only
  in prose.

## Done When

- `EventBus.emit` / `subscribe` or the adjacent event definition layer has a
  typed way to distinguish project-scoped events from daemon-wide events.
- A focused test emits from two projects and asserts subscribers can distinguish
  and filter by `projectId`.
- The new type names make the next slices straightforward: core emitters can
  migrate without guessing whether an event is project-scoped or daemon-wide.
- No project-scoped event shape introduces optional or nullable project scope.

## Source / Intent

Decomposed from strategic anchor
`task-add-projectid-to-every-event-bus-payload` after builder measured the
single-sweep blast radius at 179 emits across 53 source files plus 37 tests.
The chosen path is the safe decomposition proposed in
`.kota/runs/2026-05-08T03-28-53-940Z-builder-9wb0tj/decomposition-proposal.md`.

## Initiative

Multi-project operator supervision: every event must carry project attribution
before CLI event filtering and full daemon isolation can be completed.

## Acceptance Evidence

- Focused event-bus test proving two-project emit/subscribe isolation.
- Diff showing typed project-scoped vs daemon-wide event primitives with no
  nullable `projectId?` shortcut.
