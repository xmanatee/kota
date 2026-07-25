---
id: task-dismiss-superseded-native-harness-builder-dead-let
title: Dismiss superseded native-harness builder dead letter
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Dismiss dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d after the native-tool merge-conflict fallback lands canonically, preserving before/after diagnostics and the supersession rationale.
created_at: 2026-07-25T13:13:29.083Z
updated_at: 2026-07-25T13:13:29.083Z
---

## Problem

Builder run `2026-07-25T12-37-16-777Z-builder-mxhqzo` fixed the native-tool
merge-conflict resolver failure, but its managed worktree could not mutate the
canonical dead-letter store. The cited item remains open even though redriving
its stale source run would not exercise the candidate fix.

## Desired Outcome

After the resolver fix is canonical, dismiss
`dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d` as superseded through KOTA's
existing dead-letter control and preserve reviewable before/after evidence.

## Constraints

- Do not redrive the stale source run; it retains the old conflicted worktree
  and cannot prove the replacement behavior.
- Confirm the native-tool fallback from
  `task-make-builder-merge-conflict-recovery-compatible-wi` is canonical
  before dismissal.
- Use the existing dead-letter dismiss path rather than editing the store or
  adding a second recovery mechanism.

## Done When

- The cited dead letter has status `dismissed` with a durable rationale naming
  the superseding task and candidate run.
- Run artifacts preserve the canonical item before and after dismissal and
  prove it no longer appears in the open builder dead-letter list.

## Source / Intent

Follow-up from
`data/tasks/done/task-make-builder-merge-conflict-recovery-compatible-wi.md`
and its critic repair. Evidence id:
`dead-letter:dlq-76a47a9a-4a59-4ad7-bc61-833291ca543d`.

The implementation task records why both canonical mutation paths were blocked
inside its managed builder worktree. This task keeps the required operational
disposition explicit instead of leaving open work inside a completed task.

## Product / Safety Link

This Meta follow-up closes the remaining builder recovery record so stale
failure evidence does not consume capacity or obscure later Product and Safety
builder failures.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A run artifact records the canonical item before dismissal, the dismissal
  result and rationale, the item after dismissal, and an open builder
  dead-letter list that omits the cited id.
