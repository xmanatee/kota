---
status: open
priority: p3
---

# Fixture seed task so dispatcher sees an actionable open task

## Problem

The dispatcher workflow emits condition-based events based on repo task
queue shape. Fixture plumbing for emit-only workflows needs a seeded task
to produce one dispatchable task.

## Desired Outcome

Not applicable. The fixture runs the dispatcher workflow only; this task
is inert repository state, not work the fixture expects an agent to
complete.

## Constraints

Do not change this file from inside the fixture; the dispatcher does not
mutate tracked files.

## Done When

Never. This task exists purely as queue-shape seed state for the
dispatcher eval fixture.
