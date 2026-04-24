---
id: task-fixture-agent-call-replay-target
title: Fixture target task for decomposer agent-call replay
status: doing
priority: p2
area: architecture
summary: Models a wide-scope builder-timeout task so the decomposer fixture can exercise the agent-call branch end-to-end under replay. Mirrors the real builder-timeout shape that produced source run 2026-04-18T15-45-49-339Z-decomposer-zloyo6, without pulling in the original task's external ties.
created_at: 2026-04-24T14:00:00.000Z
updated_at: 2026-04-24T14:00:00.000Z
---

## Problem

Fixture seed task. A prior builder run (seeded as
`2026-04-24T14-00-00-000Z-builder-agcf01` in this fixture's
`.kota/runs/`) claimed this task and timed out after three hours.
The decomposer workflow is expected to pick this task out of `doing/`
and split it into two smaller ready-queue tasks.

## Desired Outcome

Not applicable. The fixture predicates verify the post-decomposer
state: this file moves to `dropped/` with a `## Decomposed` section,
two new subtasks appear in `ready/`, and the decomposer workflow
commits successfully under replay without any real LLM call.

## Constraints

This task file is fixture state. Do not refactor the body — the
recorded decompose response references the task id and the predicates
rely on the known post-state.

FIXTURE-CANARY-decomposer-agent-call-replay-target

## Done When

Never; this task exists only to exercise the decomposer agent-call
branch under replay.
