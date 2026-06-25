---
id: task-run-builder-work-and-repair-inside-task-worktrees
title: Run builder work and repair inside task worktrees
status: backlog
priority: p1
area: autonomy
task_class: Platform
depends_on: [task-add-workflow-workspace-checkout-contract, task-add-git-worktree-lifecycle-provider-for-automation, task-add-atomic-task-claim-leases-for-parallel-autonomy]
summary: Refactor the builder workflow so agent edits, critic repair, validation, branch creation, and commit happen in the task worktree instead of the canonical checkout.
created_at: 2026-06-25T14:53:39.779Z
updated_at: 2026-06-25T14:53:39.779Z
---

## Problem

`src/modules/autonomy/workflows/builder/workflow.ts` runs the build agent in
the project checkout, then creates a task branch and commits workflow changes
from that same checkout. `builder/AGENTS.md` also instructs builders and
sub-agents to work without worktree isolation. This is the main path that must
change before KOTA can support parallel agent work.

## Desired Outcome

The builder workflow claims a task, creates a prepared task worktree, runs the
builder agent and repair loops with `workspaceDir` as cwd, validates inside the
worktree, creates or updates the task branch there, and commits the result
there. The canonical checkout remains clean except for explicit queue/run-state
updates that KOTA owns.

## Constraints

- Do not bypass existing critic, repair, or validation gates.
- Do not run builder agents in the canonical checkout once worktree mode is
  enabled.
- Preserve the existing branch naming intent unless the architecture decision
  requires a safer unique branch format.
- Update scoped `AGENTS.md` instructions so they match the new runtime policy.
- Keep a feature/config gate until merge-gate and cleanup/status are in place.

## Done When

- Builder workflow creates and uses a `workspaceDir` for all mutating agent
  steps.
- `createTaskBranch` and `commitWorkflowChanges` operate on the worktree path.
- Builder prompts/instructions no longer forbid worktrees.
- Run artifacts record canonical project path, workspace path, branch, base
  commit, head commit, task id, and claim id.
- Tests cover builder worktree cwd and commit behavior.

## Source / Intent

Local scan found the current builder flow in `workflow.ts` and
`branch-per-task.ts`, and found the scoped builder instruction that says "Work
directly in this repository - no worktrees." This task converts that policy
into the desired worktree-backed builder runtime.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/autonomy/workflows/builder src/core/workflow` passes.
- A dry-run or fixture builder run writes a file only inside the task worktree,
  commits there, and leaves the canonical checkout clean.
- The run artifact includes enough metadata to inspect or resume the worktree.
