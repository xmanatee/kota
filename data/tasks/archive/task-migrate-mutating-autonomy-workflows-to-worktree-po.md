---
status: done
---

# Migrate mutating autonomy workflows to worktree policy

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

## Outcome

Added `src/modules/autonomy/workflow-workspace-policy.ts` as the audited
workflow-by-workflow policy map and connected it to the worktree-backed
autonomy decision. Builder remains the arbitrary project-file mutator on the
workspace/merge-gate path. Canonical exceptions now name their control-state or
control-plane writes and safety mechanisms. `improver` now has a clean-checkout
preflight before its agent step, and `research-retry` is narrowed to task and
inbox writes.

## Source / Intent

The user asked that KOTA automation agents learn to do all work in worktrees.
This task carries the policy beyond the initial builder implementation while
preserving KOTA's distinction between repo mutation and scheduler/control-state
mutation.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- Audit artifact: `.kota/runs/2026-06-28T15-56-27-564Z-builder-j6amm8/workflow-workspace-policy-audit.json`.
- `rg -n "no worktrees|Work directly in this repository" src/modules/autonomy`
  returned no matches.
- `pnpm test src/modules/autonomy` passed.
