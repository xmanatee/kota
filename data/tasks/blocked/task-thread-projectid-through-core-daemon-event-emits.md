---
id: task-thread-projectid-through-core-daemon-event-emits
title: Thread projectId through core daemon event emits
status: blocked
priority: p2
area: architecture
summary: Migrate core daemon, workflow runtime, and daemon-owned event emitters onto the typed project-scoped event primitive.
created_at: 2026-05-08T16:30:00.000Z
updated_at: 2026-05-08T16:30:00.000Z
---

## Problem

After the event-bus project scope primitive exists, core daemon and workflow
runtime emitters still need to attach the correct project identity. These are
the highest-risk emit sites because they drive run state, queue state,
sessions, owner questions, approvals, and control-API subscriptions.

## Desired Outcome

Every core daemon and workflow-runtime event that describes a project-scoped
fact carries the right `projectId`. Daemon-wide lifecycle or registry events
use the explicit daemon-wide event shape from the primitive slice.

## Constraints

- Build on `task-event-bus-projectid-protocol-primitives`; do not redesign the
  primitive in this slice.
- No fallback to the registry default at an internal emitter. The emitter must
  know which project runtime produced the event.
- Keep module-defined events out of scope except where a core runtime wrapper
  must pass project scope through to a module boundary.
- Preserve existing event names unless the primitive slice requires an explicit
  daemon-wide/project-scoped split.

## Done When

- Core daemon, workflow runtime, run-store, scheduler, owner-question,
  approval, notification, and queue-shape emit sites attach project scope.
- Subscribers that expose daemon control API/SSE streams can filter or project
  the scoped events without inferring from paths.
- Focused tests cover at least one workflow lifecycle event and one queue/control
  event from two projects.
- No core project-scoped event uses nullable or optional `projectId`.

## Source / Intent

Sub-slice 3b from strategic anchor
`task-add-projectid-to-every-event-bus-payload`.

## Initiative

Multi-project operator supervision: daemon-owned runtime events must be
attributable before CLI event filtering and isolation tests can be completed.

## Acceptance Evidence

- Core daemon/workflow event tests proving two-project attribution.
- Source scan or focused assertion showing no core project-scoped emit remains
  unscoped.

## Unblock Precondition

```
kind: task-done
ref: task-event-bus-projectid-protocol-primitives
```
