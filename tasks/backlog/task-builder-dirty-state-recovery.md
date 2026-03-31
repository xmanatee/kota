---
id: task-builder-dirty-state-recovery
title: Auto-reset dirty worktree before builder preflight to unblock stranded runs
status: backlog
priority: p2
area: runtime
summary: When the builder fails mid-run before the commit step, it leaves uncommitted changes in the worktree. The next builder run hits assertRepoWorktreeClean and refuses to start, stranding the queue until an operator manually resets.
created_at: 2026-03-31T02:30:00Z
updated_at: 2026-03-31T02:30:00Z
---

## Problem

`assertRepoWorktreeClean` in the builder preflight step throws if the repo has
uncommitted changes, blocking subsequent runs. This check exists to prevent one
builder run from trampling another's in-progress work.

However, when the builder itself fails mid-run (agent error, timeout, repair
loop exhaustion) before the `commit` step, the failed run's partial changes
remain in the worktree. The *next* scheduled builder run then hits the dirty
check and aborts — not because of active work, but because of leftover debris
from the previous failure.

An operator must manually run `git reset --hard` or `git checkout -- .` to
unblock the queue. Overnight autonomous runs compound the problem: one failure
can stall all subsequent runs until morning.

## Desired Outcome

The builder preflight (or the code step before the agent step) detects a dirty
worktree left by a previous *failed* run (no in-progress run, but uncommitted
changes present) and resets to the last commit automatically, logging the
discarded paths before proceeding.

The reset must be safe: it should only fire when no run is currently marked
`doing` and when the dirty state is not from an active concurrent run.

## Constraints

- Only auto-reset when the task queue shows no active `doing/` tasks AND the
  dirty state is not owned by any currently running workflow step. Do not reset
  during a live run.
- Log the list of discarded files at warning level before resetting so there is
  an audit trail in the run log.
- The reset should cover both tracked modified files and untracked new files left
  by the builder (i.e., equivalent to `git reset --hard HEAD && git clean -fd`
  scoped to the repo, excluding `.kota/` run directories).
- Do not change the behavior when the worktree is already clean — no-op path must
  be zero overhead.
- This is a workflow-layer fix only; do not modify `assertRepoWorktreeClean` or
  `repo-worktree.ts` — those are shared utilities.

## Done When

- A dirty worktree left by a failed builder run is automatically cleaned before
  the next builder run starts, with a warning log listing discarded files.
- When the worktree is already clean, behavior is identical to today.
- The existing integration tests for the builder preflight still pass.
- At least one test covers the auto-reset path (mock dirty state, assert reset
  is called and the run proceeds).
