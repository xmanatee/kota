---
id: task-add-continuous-scope-improvement-automation
title: Add continuous scope improvement automation
status: done
priority: p1
area: autonomy
summary: Add a scope-aware autonomous improvement loop that watches configured scopes, tracks changes and outcomes, and proposes or executes evidence-backed improvements without hardcoding project types.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-generic-event-batching-to-workflow-triggers]
created_at: 2026-06-03T14:01:12.443Z
updated_at: 2026-06-04T13:22:00.000Z
---

## Problem

The architecture batch covers scopes, automation vocabulary, batching, and
progress review, but the owner's first scenario asks for an agent that can be
enabled for several scopes and continuously track changes to find professional,
unbiased ways to improve them. Existing autonomy workflows are mostly
repo-task/code oriented and do not expose one generic scope-improvement loop
for code and non-code directories alike.

Without a dedicated task, KOTA could gain the protocol pieces while still
lacking the actual "watch my scopes and improve them" behavior.

## Desired Outcome

Add a continuous scope improvement automation that runs against configured
scopes, observes scoped changes and outcomes, and produces evidence-backed
improvement work. The loop should work for directory-backed scopes regardless
of domain: web app implementation, trip planning, birthday planning,
self-reflection, or other file/task/store-backed scopes.

The automation should:

- Watch configured scopes through typed events, file changes, task changes,
  run outcomes, and optional schedule ticks.
- Read local scoped instructions such as `AGENTS.md` instead of requiring
  domain-specific project types in core.
- Separate candidate discovery, evidence gathering, recommendation, and
  mutation into explicit steps.
- Prefer creating normalized tasks or owner questions for non-obvious changes.
- Allow autonomous edits only when the scope policy, write scope, and tool
  guardrails allow them.
- Produce reviewable artifacts explaining what changed, why it matters, and
  what evidence supports the improvement.

## Constraints

- Do not hardcode typed scope domains such as travel, social, code, or personal
  development.
- Do not bypass the normal task queue, workflow runtime, approval queue,
  owner-question queue, tool guardrails, or write-scope enforcement.
- Do not make this a prompt-only agent instruction. Discovery inputs,
  candidate schema, dedupe checks, and output evidence must be structured.
- Keep the loop bounded and rate-limited per scope so it cannot churn
  indefinitely on noisy directories.
- Do not duplicate the generic progress reviewer. The progress reviewer
  evaluates how work is going; this automation discovers and performs or queues
  improvements.

## Done When

- A scope improvement workflow/automation exists with structured inputs and
  output schema.
- It can be enabled for multiple configured scopes and keeps scope state
  isolated.
- It reacts to at least file/task/run events and a scheduled tick.
- It creates normalized tasks or owner questions for improvements that need
  human judgment, and it can perform a bounded safe edit when policy allows.
- Tests cover multi-scope isolation, dedupe, noisy-event throttling,
  AGENTS.md/context discovery, task creation, owner-question creation, and
  guarded mutation.
- Fixture evidence demonstrates one code scope and one non-code directory
  scope producing clear, evidence-backed improvement outputs.

## Source / Intent

Owner request from `data/inbox/many.md`: "I enable kota for 3 projects
(directories) and there's an agent which monitors them contineously, tracks
changes and figures out ways to improve them... Projects could be anything:
trip-planning, friends birthday planning, web application implementation,
self-improvement and reflections..."

Follow-up answer clarified that these should be scopes, not typed projects.

## Initiative

Scope-aware continuous improvement: KOTA should be able to improve any
configured scope through evidence and local instructions, without core knowing
the scope's domain.

## Acceptance Evidence

- Workflow tests for multi-scope continuous improvement.
- Run artifacts under `.kota/runs/<run-id>/` for one code scope and one
  non-code scope showing detected evidence, recommendation, and resulting task,
  owner question, or safe edit.
- Task queue validation output after generated task fixtures.
