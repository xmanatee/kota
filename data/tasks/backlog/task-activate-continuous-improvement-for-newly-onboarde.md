---
id: task-activate-continuous-improvement-for-newly-onboarde
title: Activate continuous improvement for newly onboarded scopes
status: backlog
priority: p1
area: autonomy
task_class: Product
depends_on: [task-add-one-transactional-external-scope-onboarding-se]
summary: Attach existing scope-improver and normal task workflows to a newly registered scope according to its resolved policy and onboarding mode.
created_at: 2026-07-31T16:12:57.060Z
updated_at: 2026-07-31T16:12:57.060Z
---

## Problem

`scope-improver` already provides the requested continuous observation and
improvement loop, with per-scope throttling, task/owner-question output, and
bounded edits. However, runtime schedules and workflow subscriptions are built
at daemon startup, and no onboarding lifecycle proves that a newly added live
scope receives them or gets an initial evidence-based run.

Without explicit activation, Add Scope could report success while doing no
work until restart or while applying unsafe defaults copied from KOTA itself.

## Desired Outcome

Make successful onboarding activate the existing automation stack for the new
runtime. Resolve one onboarding mode into existing scope policy and
`scope-improvement` configuration, register the normal contributed workflows,
and emit one initial `autonomy.scope-improvement.requested` event when readiness
allows it.

Expose three understandable postures without introducing project types:
observe/ask, create proposed tasks, and autonomous execution within explicit
write policy. The resolved policy and existing guardrails remain authoritative.

## Constraints

- Reuse `scope-improver`, dispatcher, builder, task/owner-question queues,
  schedules, workflow definitions, and recovery. Do not create an onboarding
  workflow engine or a second continuous-improvement agent.
- Default to observe/ask with autonomous edits disabled and no write paths.
- Activation occurs only after registry, runtime, trust/policy, project state,
  and required setup are committed. A blocked scope remains registered with an
  explainable readiness state but does not dispatch impossible work.
- Each scope has isolated runs, claims, worktrees, events, tasks, schedules,
  backoff, and recovery state.
- Repeated activation or daemon restart must not duplicate schedules, pending
  runs, tasks, or initial improvement requests.

## Done When

- A newly onboarded scope receives the existing workflow definitions and
  schedules without daemon restart.
- Its selected onboarding posture resolves through scope policy and existing
  improvement config, and clients can explain what automation may do.
- The first eligible improvement request produces evidence and then a task,
  owner question, safe edit, or explicit no-action result inside that scope.
- Missing provider/setup, untrusted config, policy denial, and no actionable
  evidence park cleanly without global daemon pause or cross-scope backoff.
- Restart restores exactly one automation registration and preserves throttle
  and dedupe state.

## Source / Intent

Owner request on 2026-07-31: after adding a folder, KOTA should begin ongoing
automated improvement there, potentially improving existing agents or creating
new tasks/workflows as evidence requires. Existing implementation evidence is
in `src/modules/autonomy/workflows/scope-improver/`; this task connects it to
live onboarding rather than replacing it.

## Initiative

Self-service external scope onboarding.

## Acceptance Evidence

- Runtime artifacts for observe/ask and bounded-write modes show resolved
  policy, one initial trigger, recommendation/action, and isolated scope paths.
- A restart fixture proves schedules and the initial trigger are not duplicated.
- A blocked-setup fixture proves one scope parks without pausing or backing off
  healthy sibling scopes.
