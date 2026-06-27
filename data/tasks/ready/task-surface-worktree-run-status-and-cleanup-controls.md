---
id: task-surface-worktree-run-status-and-cleanup-controls
title: Surface worktree run status and cleanup controls
status: ready
priority: p1
area: autonomy
task_class: Product
depends_on: [task-add-git-worktree-lifecycle-provider-for-automation, task-add-merge-gate-and-automated-conflict-resolver-for]
summary: Expose active, pending-merge, conflicted, merged, and cleanup states for automation worktrees in CLI, daemon status, and run artifacts.
created_at: 2026-06-25T14:53:51.690Z
updated_at: 2026-06-27T15:01:08.998Z
---

## Problem

Parallel worktrees are only safe if the operator can see what exists and why.
Otherwise abandoned worktrees, pending conflicts, stale claims, and cleanup
failures become invisible repo state. Existing status surfaces are centered on
workflow/daemon state, not per-worktree lifecycle.

## Desired Outcome

KOTA status surfaces show automation worktrees with state, task id, run id,
branch, base commit, head commit, claim owner, dirty/conflict state, merge
status, cleanup eligibility, and the next safe action. Cleanup commands or
workflow steps remove only eligible worktrees and explain refusals.

## Constraints

- Do not show a worktree as "cleaned" until `git worktree list` and KOTA
  metadata agree.
- Do not hide pending conflicts behind generic failure labels.
- Keep CLI and daemon status backed by the same state model.
- Do not require the user to inspect `.git/worktrees` manually to recover.

## Done When

- CLI/status output lists active, pending-merge, conflicted, merged, and
  cleanup-blocked worktrees.
- Cleanup refuses dirty, untracked, unpushed, locked, or conflicted worktrees
  with explicit reasons.
- Run artifacts link to worktree metadata and cleanup outcome.
- Tests cover status rendering and cleanup refusal reasons.

## Source / Intent

Codex and Claude Code both make worktree state operator-visible and treat
cleanup conservatively. KOTA needs equivalent visibility so parallel autonomy
does not create hidden local state.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/daemon-ops src/modules/autonomy` or the nearest
  status tests pass.
- A CLI transcript shows at least one active worktree, one merged/cleanup-ready
  worktree, and one cleanup-blocked worktree with reason.
