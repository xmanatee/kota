---
id: task-migrate-mutating-autonomy-workflows-to-worktree-po
title: Migrate mutating autonomy workflows to worktree policy
status: ready
priority: p1
area: autonomy
task_class: Platform
depends_on: [task-run-builder-work-and-repair-inside-task-worktrees, task-add-merge-gate-and-automated-conflict-resolver-for, task-surface-worktree-run-status-and-cleanup-controls]
summary: Audit all mutating autonomy agents and either migrate them to the workspace/merge contract or document why they are control-only and safe outside it.
created_at: 2026-06-25T14:53:56.712Z
updated_at: 2026-06-28T15:52:35.545Z
---

## Problem

The owner asked for "automation agents" broadly, not just builder. KOTA has
multiple autonomy workflows, some of which mutate code, docs, tasks, decisions,
or run state. If builder moves to worktrees but other mutating agents keep
editing the canonical checkout, parallel safety remains partial and the local
instructions will drift.

## Desired Outcome

Every autonomy workflow is classified as one of:

- mutates repo/project files and must use the worktree workspace/merge contract;
- mutates only KOTA-owned control state and is safe in the canonical project
  path with explicit locking;
- read-only observer.

Mutating agent workflows are migrated to the worktree policy or have a recorded
reason and safety mechanism for staying outside it.

## Constraints

- Do not force read-only observers into unnecessary worktrees.
- Do not move task-queue/control-state writes into transient worktrees unless
  the architecture decision requires it.
- Update scoped `AGENTS.md` files when runtime policy changes.
- Keep docs and data files aligned with actual behavior.

## Done When

- Autonomy workflows and scoped instructions are audited.
- Every mutating workflow either uses `workspaceDir` and merge-gate or records
  a specific control-state exception.
- Tests or fixtures cover at least one migrated non-builder workflow or one
  explicit exception.
- The architecture docs or decision entry reflect the final classification.

## Source / Intent

The user asked that KOTA automation agents learn to do all work in worktrees.
This task carries the policy beyond the initial builder implementation while
preserving KOTA's distinction between repo mutation and scheduler/control-state
mutation.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- An audit artifact or decision entry lists each autonomy workflow and its
  workspace policy.
- `rg -n "no worktrees|Work directly in this repository" src/modules/autonomy`
  no longer finds stale instructions except deliberate documented exceptions.
- `pnpm test src/modules/autonomy` passes for migrated workflows.
