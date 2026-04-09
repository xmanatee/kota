---
id: task-builder-branch-cleanup
title: Clean up merged kota/task/* branches after builder PRs are merged
status: ready
priority: p2
area: runtime
summary: The branch-per-task builder mode creates a kota/task/<task-id> branch per run but never deletes them. Merged branches accumulate indefinitely in the remote, creating noise and making the branch list unmanageable for long-running projects.
created_at: 2026-04-09T01:50:00Z
updated_at: 2026-04-09T01:50:00Z
---

## Problem

`task-builder-branch-per-task` explicitly deferred branch cleanup as out of scope.
The builder now creates `kota/task/<task-id>` branches and opens PRs. Once a PR is
merged, the source branch is no longer needed. With multiple builder runs per day,
`kota/task/*` branches accumulate:

- Remote branch list grows unbounded.
- `git branch -r` becomes noisy for human contributors.
- Stale branches can trigger CI or branch-protection re-scans on some platforms.

## Desired Outcome

After each builder run in branch-per-task mode, the workflow detects whether the PR
created in the current run was merged (or if previous `kota/task/*` branches have
already-merged PRs) and deletes the remote branch for any merged PR.

The cleanup step:
1. Runs after the commit/PR step in the builder workflow.
2. Uses `gh pr list --state merged --head "kota/task/*"` to find merged PRs with
   kota-managed branches.
3. Deletes the remote branch for each merged PR via `gh api` or `git push origin
   --delete`.
4. Logs names of cleaned-up branches to the run artifact.

Cleanup is best-effort: if `gh` is unavailable or the delete fails, the run continues
and logs a warning rather than failing.

## Constraints

- Only applies when branch-per-task mode is enabled; no-op otherwise.
- Only deletes branches matching `kota/task/*` — never touches other branches.
- Best-effort: a cleanup failure should not fail the builder run.
- The current run's own branch should not be deleted until after the PR is opened
  (cleanup targets *previously* merged branches).
- No new config keys needed; cleanup is inherent to branch-per-task mode.

## Done When

- After a branch-per-task builder run, previously merged `kota/task/*` remote branches
  are deleted automatically.
- The run artifact (run directory) includes a log of which branches were cleaned up or
  skipped.
- A test covers: merged branches are deleted; unmerged branches are left; cleanup
  failure is non-fatal.
- Manual verification: after several merged builder PRs, `git branch -r | grep
  kota/task` returns only open/unmerged branches.
