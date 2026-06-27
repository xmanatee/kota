---
id: task-add-git-worktree-lifecycle-provider-for-automation
title: Add git worktree lifecycle provider for automation runs
status: ready
priority: p1
area: modules
task_class: Platform
depends_on: [task-record-architecture-decision-for-worktree-backed-a]
summary: Provide a tested KOTA-owned service for creating, locking, preparing, removing, and reporting per-run git worktrees.
created_at: 2026-06-25T14:53:29.335Z
updated_at: 2026-06-27T04:08:01.992Z
---

## Problem

Builder and branch-per-task logic currently issue git operations directly
against the project checkout. KOTA needs a reusable lifecycle provider for
automation worktrees so every mutating workflow follows the same branch naming,
setup, locking, cleanup, and safety rules.

## Desired Outcome

KOTA has a tested worktree provider that can:

- create a unique per-run worktree under a repo-local ignored path such as
  `.worktrees/<task-id>-<run-id>`;
- create or attach a unique automation branch;
- lock active worktrees while an agent owns them;
- copy only explicitly allowed ignored setup files, using a KOTA equivalent of
  the Codex `.worktreeinclude` idea;
- report branch, base commit, head commit, dirty state, lock state, and cleanup
  eligibility;
- remove worktrees only after safety checks pass.

## Constraints

- Do not copy arbitrary untracked files into worktrees.
- Do not delete or prune worktrees with uncommitted, untracked, unpushed, or
  conflicted work.
- Do not assume the same branch can be checked out in multiple worktrees.
- Keep branch names deterministic enough for status and cleanup, but unique
  enough for repeated runs.
- Update `.gitignore` or local docs if the chosen worktree root requires it.

## Done When

- A module-level API covers create, prepare, lock, unlock, inspect, and cleanup.
- Tests cover happy path, existing branch collision, active lock, dirty
  worktree, untracked files, and safe removal.
- The provider records enough metadata for merge-gate and status surfaces to
  resume after daemon restart.
- The chosen ignored-files inclusion mechanism is documented and tested.

## Source / Intent

Claude Code locks active worktrees and only cleans up old worktrees without
uncommitted, untracked, or unpushed work. Codex managed worktrees use
`.worktreeinclude` for local ignored setup files. KOTA needs equivalent local
semantics before automation can safely create and remove worktrees.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/modules/git src/modules/autonomy` or the nearest affected
  module tests pass.
- A fixture creates, inspects, locks, unlocks, and removes a worktree without
  touching the canonical checkout.
- A dirty-worktree fixture refuses cleanup and records the reason.
