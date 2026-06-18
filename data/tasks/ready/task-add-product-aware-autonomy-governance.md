---
id: task-add-product-aware-autonomy-governance
title: Add product aware autonomy governance
status: ready
priority: p1
area: autonomy
summary: Teach builder, improver, decomposer, progress-reviewer, critic, and repair escalation to prefer Product/Safety outcomes and require Meta tasks to close visible blockers.
created_at: 2026-06-11T22:24:13.509Z
updated_at: 2026-06-18T19:36:00.238Z
task_class: Platform
---

## Problem

Autonomous workflows can spend too much attention on internal repair,
evaluator drift, fan-out consolidation, and meta-process tasks while P1
owner-visible Product work remains backlog or blocked. The current reporting
and critic gates do not make "green tests but unchanged operator UX" a clear
failure mode.

## Desired Outcome

Builder, improver, decomposer, progress-reviewer, critic, and repair
escalation should use `task_class` and rendered evidence policy to prefer
Product/Safety outcomes and restrict Meta work to visible blockers.

## Constraints

- Do not cap autonomy by default; fix queue shaping and review gates instead.
- Do not suppress Safety/P0/runtime failure repair.
- Do not require rewriting every historical task.
- Keep classification inspectable in run artifacts and operator reports.

## Done When

- Builder/decomposer selection prefers P1 Product/Safety over Meta work unless
  the runtime or Safety posture is broken.
- Critic rejects Product tasks that pass tests but lack required operator
  journey evidence.
- Progress-reviewer reports Product/Safety/Platform/Meta distribution and flags
  green-test/unchanged-UX outcomes.
- Workflow-failure escalation consolidates repeated same-root-cause repair
  tasks instead of fanning out duplicates.

## Source / Intent

Owner request on 2026-06-11: KOTA appears to optimize and repair itself while
the simple product surfaces remain weak and some tasks look done before the
experience is actually complete.

## Initiative

KOTA product-aware autonomy governance.

## Acceptance Evidence

- Queue governance tests show Product/Safety outranks actionable Meta work.
- Critic fixture shows a Product task with passing tests but no rendered
  evidence fails review.
- Workflow-failure-escalator fixture shows repeated same-root-cause failures
  create one consolidated repair task.
- `kota report` transcript includes Product/Safety/Platform/Meta distribution.
