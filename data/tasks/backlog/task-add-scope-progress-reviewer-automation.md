---
id: task-add-scope-progress-reviewer-automation
title: Add scope progress reviewer automation
status: backlog
priority: p1
area: autonomy
summary: Add a generic progress-reviewer automation that periodically or count-threshold reviews scoped runs, logs, tasks, artifacts, and changes to assess whether agents and workflows are producing the intended outcomes.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-generic-event-batching-to-workflow-triggers]
created_at: 2026-06-03T13:40:47.946Z
updated_at: 2026-06-03T13:41:17.000Z
---

## Problem

KOTA has autonomy workflows such as decomposer, builder, critic, improver,
evaluator, queue shapers, and blocked-research retry. The owner wants a more
general progress reviewer: an automation that can run on schedules, event
counts, task counts, message counts, or other thresholds, then inspect scoped
logs, inputs, outputs, recent changes, tasks, runs, and artifacts to assess
whether agents/workflows are actually achieving the intended outcomes.

Today this behavior exists only in narrower improver/evaluator patterns and
does not form one reusable, scope-aware review protocol.

## Desired Outcome

Add a generic progress-reviewer automation. It should review activity within a
scope over a bounded window and produce an evidence-backed assessment with
operator-actionable follow-up tasks or owner questions when steering is needed.

The reviewer should support:

- Triggers by schedule, run count, task count, message/event batch, and manual
  request.
- Scope selection, including global scope and directory scopes.
- Inputs from workflow run artifacts, task changes, event batches, git/file
  changes where applicable, owner-question/approval outcomes, channel intake,
  and agent outputs.
- Output as a structured review artifact with claims tied to evidence.
- Optional task creation through the normal repo-task scaffold when a concrete
  repair or improvement is needed.
- Guardrails against self-congratulation, prompt-only quality checks, and
  duplicate task spam.

## Constraints

- Do not make this a second improver loop with a different task model. It must
  use KOTA's normal automation/workflow, event batching, scope, task, and owner
  question mechanisms.
- Do not rely on the agent prompt to remember every review rule. Critical
  invariants must be enforced through structured inputs, schemas, validators,
  dedupe checks, and acceptance evidence.
- Keep the review bounded. It should declare the window, included artifacts,
  and excluded artifacts so results are reproducible.
- Separate evaluation from generation. The reviewer assesses evidence and may
  create tasks; it does not directly mutate product code.
- Avoid duplicate tasks by searching existing open tasks and related inbox
  entries before creating new work.

## Done When

- A progress-reviewer workflow/automation exists with structured inputs and
  output schema.
- It can run from a cron/schedule trigger, a count-based batch trigger, and a
  manual trigger.
- It reads scoped run/task/event/artifact evidence and writes a bounded review
  artifact under `.kota/runs/<run-id>/`.
- It creates normalized tasks only when the review identifies concrete,
  non-duplicate work with acceptance evidence.
- Tests cover schedule trigger, count/batch trigger, scope isolation,
  duplicate-task avoidance, structured output validation, and no-op reviews.
- At least one fixture demonstrates reviewing a channel-processing scope and
  one fixture demonstrates reviewing an autonomous coding scope.

## Source / Intent

Owner request from `data/inbox/many.md`: "scheduled or regular (not
necessarily by time but could be by the number of tasks completed or messages
processed or anything really) hook-agent that assesses what has been done in
certain scope or by specific agents and really analyse logs and inputs and
outputs and recent changes and other produced artifacts and assess how well
the desired tasks are performed."

Relevant current code/docs: `src/modules/autonomy/AGENTS.md`,
`src/modules/autonomy/workflows/`, `src/modules/repo-tasks/`,
`src/core/workflow/`, and `src/core/events/event-bus-types.ts`.

## Initiative

Outcome-aware autonomy: KOTA should regularly assess whether work in a scope is
actually improving the intended target and steer through typed tasks and owner
questions when evidence says it is not.

## Acceptance Evidence

- Progress-reviewer workflow tests and fixture output.
- A run artifact under `.kota/runs/<run-id>/` containing a structured review,
  cited evidence, and either no-op justification or created task ids.
- Task queue validation output after any reviewer-created task fixture.
