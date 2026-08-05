---
id: task-reconcile-preserved-recovery-stashes-through-state
title: Reconcile preserved recovery stashes through state recovery
status: backlog
priority: p1
area: core
task_class: Meta
summary: Inventory and disposition unique historical recovery stashes through the canonical recovery projection without losing unsuperseded work.
created_at: 2026-08-05T06:45:45.708Z
updated_at: 2026-08-05T06:45:45.708Z
---

## Problem

Crash recovery accumulated 325 hidden Git stash entries while repeatedly
dispatching every recovery-capable workflow against the same dirty checkout.
The runtime now limits recovery to the workflow that owns the interrupted or
persisted incident, but 315 distinct historical snapshots still contain
potentially unsuperseded task, queue, and source changes. They are invisible to
`workflow state-recovery`, so operators cannot distinguish valuable work from
safe cleanup without manual Git archaeology.

## Desired Outcome

Make recovery stash snapshots an explicit input to the existing recovery
decision projection. Inventory each snapshot once, associate it with its
source workflow/run/task and related commits, and produce an evidence-backed
disposition: recover, supersede, preserve for review, or remove. Accepted
dispositions must update the same recovery artifact used for claims,
worktrees, DLQs, and task state.

## Constraints

- Extend the canonical recovery projection and CLI; do not add a second stash
  registry, cleanup workflow, archive, or parallel source of truth.
- Never apply or delete a unique snapshot solely because it is old. Compare
  working, index, and untracked trees with canonical commits and related task
  evidence first.
- Keep Git stash as temporary physical storage only. Once every existing
  snapshot has a durable disposition, new recovery must use the canonical
  recovery lifecycle instead of accumulating hidden stash entries.
- Keep deterministic guards narrow: exact duplicate and exact supersession
  checks may recommend cleanup; ambiguous code requires recovery-reviewer
  judgment.

## Done When

- `workflow state-recovery list --json` reports every remaining recovery stash
  with source provenance, diff summary, related task/run, unique tree identity,
  and one recommended action.
- One resolve operation records the decision and performs the corresponding
  recover, supersede, preserve, or safe-remove action without partial state.
- The current historical inventory is reduced to zero undispositioned
  snapshots without discarding unsuperseded work.
- Repeated startup/recovery incidents do not create duplicate stash entries or
  dispatch unrelated recovery-capable workflows.

## Source / Intent

Runtime investigation on 2026-08-05 found 325 recovery stash entries produced
by repeated startup recovery. Exact tree comparison identified only ten safe
duplicate/superseded entries; the remaining 315 snapshots are distinct and
must not be discarded without semantic evidence. This closes the remaining
state-recovery source-of-truth gap behind the owner's request for no hidden
leftovers or ambiguous recovery state.

## Initiative

Canonical autonomy recovery and uninterrupted daemon progress.

## Acceptance Evidence

- A machine-readable inventory artifact maps all current stash tree identities
  to runs, tasks, commits, and final dispositions.
- CLI transcripts show `workflow state-recovery list --json`, ambiguous-review
  preservation, an evidence-backed recovery, and exact safe cleanup.
- A restart/repeated-recovery fixture proves no duplicate stash or unrelated
  recovery fanout is created.
