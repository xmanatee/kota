---
status: open
priority: p1
---

# Report builder delivery outcomes truthfully

## Problem

Builder run `2026-08-11T12-06-15-974Z-builder-2ztd9j` committed useful work as
`2d15ad78a`, moved its target task to `blocked` because a severe source-size
gate remained, and still wrote `outcome: success`. Workflow history therefore
reports a successful builder even though the task is unresolved. Progress,
health, and throughput reporting can count a partial committed repair as
completed delivery, masking queue stalls and distorting provider comparisons.

## Desired Outcome

Represent workflow execution and task delivery as distinct typed facts. A run
may reach `succeeded`, `failed`, `cancelled`, or `needs_attention` while its
target task remains `done`, `blocked`, `dropped`, or unresolved. Operator
status, history, reviews, and metrics use the task outcome when answering
whether work actually progressed.

## Constraints

- Preserve useful commits and terminal cleanup; do not turn every task blocker
  into a workflow exception or discard partial work.
- Derive delivery disposition from the canonical task transition, run state,
  integration result, validation, and recovery evidence. Do not add a second
  mutable status store.
- Keep execution status available for runtime reliability metrics, but do not
  label committed-but-blocked work as completed task delivery.
- Update all consumers together and remove ambiguous legacy fields or fallback
  interpretation rather than supporting both meanings indefinitely.

## Done When

- Run metadata and summaries expose one typed execution result and one typed
  delivery disposition with exhaustive consumer handling.
- An integrated task moved to `done` reports completed delivery; an integrated
  task moved to `blocked` reports preserved partial work and its blocker;
  failed and `needs_attention` cases remain distinguishable.
- `kota workflow status/history`, progress review, health review, and recent-run
  productivity metrics agree on the same delivery counts.
- Replaying the cited run no longer increments completed-task throughput while
  still showing commit `2d15ad78a` and clean resource disposition.

## Source / Intent

Created from the owner-requested last-50-commit and run audit on 2026-08-13.
The owner wants the six-hour supervisor to distinguish productive long work
from stalls; truthful delivery semantics are required for that decision.

## Initiative

Outcome-grade autonomous execution telemetry.

## Product / Safety Link

Accurate delivery state prevents Product and Safety tasks from appearing
complete while they remain blocked and lets supervision prioritize real queue
stalls rather than successful runtime mechanics.

## Acceptance Evidence

- A replay artifact for completed, integrated-blocked, needs-attention,
  cancelled, and failed builder cases showing identical disposition across run summary,
  CLI history, progress review, and health projection.
- Before/after latest-run throughput report including the cited builder.
