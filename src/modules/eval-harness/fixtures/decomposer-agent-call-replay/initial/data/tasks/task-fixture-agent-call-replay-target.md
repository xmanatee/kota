---
status: open
priority: p2
---

# Fixture target task for decomposer agent-call replay

## Problem

Fixture seed task. A prior builder run (seeded as
`2026-04-24T14-00-00-000Z-builder-agcf01` in this fixture's
`.kota/runs/`) was dispatched for this exact task and timed out after three hours.
The decomposer workflow is expected to authenticate this still-open task from
the failed builder contract and split it into two smaller open tasks.

## Desired Outcome

Not applicable. The fixture predicates verify the post-decomposer
state: this file moves to `data/tasks/archive/` with status `dropped` and a
`## Decomposed` section, two new subtasks appear under `data/tasks/`, and the decomposer workflow
publishes successfully under replay without any real LLM call.

## Constraints

This task file is fixture state. Do not refactor the body — the
recorded decompose response references the task id and the predicates
rely on the known post-state.

FIXTURE-CANARY-decomposer-agent-call-replay-target

## Done When

Never; this task exists only to exercise the decomposer agent-call
branch under replay.
