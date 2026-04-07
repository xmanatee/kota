---
id: task-builder-branch-per-task
title: Builder opt-in branch-per-task with auto-PR creation
status: backlog
priority: p3
area: runtime
summary: The builder commits directly to the current branch, giving operators no natural review point. An opt-in mode that creates a task-scoped branch and opens a PR lets teams use standard code review without abandoning autonomous operation.
created_at: 2026-03-30T20:20:00Z
updated_at: 2026-04-07T12:00:00Z
---

## Problem

The builder workflow commits changes directly to whatever branch is checked out
(typically `main`). For operators who want code review or staged merging, there is no
hook short of disabling the builder entirely. Every builder run is an undifferentiated
commit that lands immediately in the main branch, making rollback harder and review
impossible without post-hoc inspection of `.kota/runs/` artifacts.

## Desired Outcome

An opt-in builder mode (configured via the builder extension config or `kota.config`)
where each task run:
1. Creates a branch `kota/task/<task-id>` from the current base.
2. Commits the task changes to that branch.
3. Opens a GitHub PR against the base branch via `gh pr create`, with the PR body
   including the task title, a link to the `.kota/runs/` run artifact, and a short
   diff summary.
4. Leaves the base branch unchanged.

Default behavior (direct commit to current branch) is unchanged when the flag is off.

## Constraints

- Opt-in only; default behavior must be identical to today.
- Requires `gh` CLI to be available and authenticated; builder should fail gracefully
  with a clear error if `gh` is missing or unauthenticated.
- Branch cleanup (after PR merge/close) is out of scope for this task.
- No changes to the daemon, session, or core loop layers — this is a builder workflow
  change only (workflow steps and/or builder agent prompt).
- The new mode must not affect existing integration tests that run without `gh`.

## Done When

- Builder config accepts an optional `branchPerTask: true` flag.
- When enabled, builder creates a `kota/task/<task-id>` branch, commits to it, and
  opens a PR with a useful description.
- When disabled (default), behavior is identical to today and existing tests pass.
- The PR creation step is guarded: if `gh` is unavailable or unauthenticated, the run
  fails with a descriptive error rather than silently skipping PR creation.
