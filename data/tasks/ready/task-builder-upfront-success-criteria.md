---
id: task-builder-upfront-success-criteria
title: Builder must declare success criteria before implementing
status: ready
priority: p2
area: autonomy
summary: The builder workflow should require the agent to define explicit, verifiable success conditions before starting implementation, creating a TDD-style feedback loop that prevents premature completion.
created_at: 2026-04-10T12:47:56Z
updated_at: 2026-04-10T12:47:56Z
---

## Problem

The builder agent currently picks up a task and implements it, then post-check
validations and the repair loop catch failures. But there is no upfront
commitment to what "done" looks like. The agent can drift, do partial work, or
satisfy checks without truly completing the intent of the task. Research on
agent effectiveness consistently shows that explicit goal-state declaration
combined with a feedback loop produces better outcomes than open-ended
implementation followed by reactive repair.

## Desired Outcome

Before the builder begins implementation on any task, it must produce a short,
concrete list of success conditions — observable, verifiable statements about
what the repo should look like when the work is complete. These conditions
should then serve as the termination criteria: the agent should not mark work
as done until all declared conditions are satisfied.

## Constraints

- Must not be a heavyweight planning phase — a few clear sentences, not a
  design document.
- Should integrate with the existing repair loop so that declared conditions
  are checked alongside test/lint validations.
- Must work for both feature tasks and bug-fix tasks.
- Research best practices for agent feedback loops and success-condition
  frameworks before designing the mechanism.

## Done When

- Builder workflow includes a step or sub-step where the agent declares
  success criteria before implementation begins.
- Declared criteria are available to the repair loop and post-check validation.
- The agent cannot mark a task as complete without satisfying its declared
  criteria.
