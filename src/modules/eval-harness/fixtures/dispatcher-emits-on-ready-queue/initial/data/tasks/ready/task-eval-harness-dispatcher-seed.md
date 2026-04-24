---
id: task-eval-harness-dispatcher-seed
title: Fixture seed task so dispatcher sees a non-empty ready queue
status: ready
priority: p3
area: eval-harness
summary: Seeded by the dispatcher-emits-on-ready-queue fixture. Its only role is to make pullableCount > 0 so the dispatcher emits autonomy.queue.available.
created_at: 2026-04-24T00:00:00.000Z
updated_at: 2026-04-24T00:00:00.000Z
---

## Problem

The dispatcher workflow emits condition-based events based on repo task
queue shape. Fixture plumbing for emit-only workflows needs a seeded task
to produce a non-empty pullable count.

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
