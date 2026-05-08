---
id: task-thread-projectid-through-module-event-emits
title: Thread projectId through module event emits
status: blocked
priority: p2
area: architecture
summary: Migrate module-defined events and remaining production/test emit sites onto the typed project-scoped event primitive.
created_at: 2026-05-08T16:30:00.000Z
updated_at: 2026-05-08T16:30:00.000Z
---

## Problem

Once the event-bus primitive and core daemon emitters carry project scope, the
remaining module-defined events and tests still need the same strict shape.
Leaving modules implicit would recreate cross-project leakage at the outer
capability layer even if core runtime events are scoped.

## Desired Outcome

Every module-defined project-scoped event carries `projectId` through the same
typed primitive as core events. Cross-project or daemon-wide module events are
declared separately and intentionally.

## Constraints

- Build on the primitive and core-daemon slices; do not add a second module-only
  event scope convention.
- No broad nullable compatibility path. Update emitters and subscribers instead.
- Keep the sweep mechanical and complete: production emitters first, then tests
  and fixtures in the same commit.
- If an event is genuinely daemon-wide, name that explicitly in the type or
  event declaration.

## Done When

- Module event definitions and emit sites carry project scope where applicable.
- Remaining production/test emit sites from the measured 179-site inventory are
  either scoped or explicitly daemon-wide.
- A focused source scan or test fails if a project-scoped module event can emit
  without project identity.
- Dependent blocked tasks for multi-project isolation and CLI event filtering
  can promote after this lands.

## Source / Intent

Sub-slice 3c from strategic anchor
`task-add-projectid-to-every-event-bus-payload`.

## Initiative

Multi-project operator supervision: module-owned capabilities must not leak
events across projects.

## Acceptance Evidence

- Module-event tests or source scan proving no project-scoped module event
  remains unscoped.
- Updated fixtures/tests for remaining emit sites.

## Unblock Precondition

```
kind: task-done
ref: task-thread-projectid-through-core-daemon-event-emits
```
