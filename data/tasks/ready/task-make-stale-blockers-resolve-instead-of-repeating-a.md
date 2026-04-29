---
id: task-make-stale-blockers-resolve-instead-of-repeating-a
title: Make stale blockers resolve instead of repeating attention noise
status: ready
priority: p1
area: autonomy
summary: Upgrade attention-digest and blocked-promoter behavior so stale owner-decision and operator-capture blockers either progress, re-ask with concrete choices, or become explicitly re-scoped.
created_at: 2026-04-29T12:53:17.230Z
updated_at: 2026-04-29T12:53:17.230Z
---

## Problem

Attention digest is correctly surfacing stale blockers, but repeated attention
items are not enough. On 2026-04-29 it reported owner-decision and stale
blocker entries including tasks blocked 6-11 days, plus "more long-blocked
tasks." The blocked queue still had 8 tasks:

- owner-decision blockers that need a concrete re-ask or defaultable proposal;
- operator-capture blockers that require exact human-captured artifacts;
- task-done blockers that should auto-promote once their prerequisite closes;
- capability-installed blockers for authenticated/rendered browser access.

The current behavior is observability-heavy: it keeps saying the queue is
blocked, but it does not reliably turn stale blockers into the next actionable
step.

## Desired Outcome

Stale blockers either progress, re-ask, or get re-scoped. The workflow layer
should distinguish "blocked but fresh" from "blocked and needs intervention"
and choose a concrete action:

- owner-decision: re-ask with the task's proposed answers and recommended
  default, or record why the owner ask is still waiting;
- operator-capture: surface the exact command/path/artifact request and, where
  possible, create a smaller unblocked preparatory task;
- task-done: auto-promote when the referenced task reaches done;
- capability-installed: re-check capability status and keep the blocker honest;
- stale impossible blocker: move to a better state or create a replacement task
  instead of repeating the same alert forever.

## Constraints

- Do not fake progress on genuinely blocked work. If the required owner answer,
  operator capture, or installed capability is absent, the task must remain
  honestly blocked.
- Do not create one task per stale blocked item unless the split is genuinely
  actionable. Prefer improving blocked-promoter/attention behavior.
- Preserve the validator-supported `## Unblock Precondition` shape so
  automation can keep checking blockers.
- Do not spam the owner. Re-asks need cooldowns, context, and concrete choices.
- Keep attention-digest concise; detailed blocker action plans belong in run
  artifacts or task bodies.

## Done When

- Blocked-promoter or a neighboring autonomy workflow classifies stale blocked
  tasks by unblock kind and age, then records the proposed action in a run
  artifact.
- Owner-decision blockers past threshold are re-asked through the existing
  owner-question mechanism with proposed answers and a recommended option when
  present in task context.
- Operator-capture blockers past threshold surface exact command/path/artifact
  instructions and either:
  - remain blocked with a refreshed ask marker; or
  - produce/promote an unblocked preparatory task when useful.
- Attention digest stops repeating a generic stale-blocker list when a concrete
  blocker action has already been emitted within the cooldown window.
- Tests cover owner-decision re-ask, operator-capture action emission,
  task-done auto-promotion, capability-installed still-blocked, and cooldown
  behavior.

## Source / Intent

Owner asked on 2026-04-29 for the workflows to address execution
shortcomings. The attention-digest run at
`.kota/runs/2026-04-29T06-49-59-043Z-attention-digest-kqcax1/` reported
multiple stale blockers and an empty ready queue. The 7-day `kota report`
showed 8 blocked tasks split across task-done, capability-installed,
owner-decision, and operator-capture blocker kinds.

## Initiative

Autonomy queue health: blocked work should remain honest while still moving
toward a concrete next action.

## Acceptance Evidence

- Unit/integration test output for stale-blocker action selection and cooldown
  behavior.
- A run-directory blocker-action artifact showing each blocker kind and its
  chosen next action.
- An attention-digest fixture proving stale blockers are summarized without
  repeating already-actioned noise.
