---
id: task-make-kota-autonomy-worktree-backed-and-merge-gated
title: Make KOTA autonomy worktree-backed and merge-gated
status: backlog
priority: p1
area: autonomy
task_class: Platform
anchor: true
summary: Make mutating autonomy agents work in isolated task worktrees, validate and merge through a gate, resolve or surface conflicts, and clean up worktrees so parallel work is safe.
created_at: 2026-06-25T14:53:12.110Z
updated_at: 2026-06-25T14:53:12.110Z
---

## Problem

KOTA's builder workflow currently performs agent edits in the canonical project
checkout, then creates a task branch and commits from that checkout. The local
builder instructions also explicitly say "no worktrees." That keeps the system
simple, but it prevents safe parallel builders and makes merge conflicts show
up late in the user's working tree.

External coding-agent systems converge on a different shape: isolate each
mutating run in a worktree, clone, or ephemeral VM, validate there, and merge
back only through an explicit gate. Git worktrees solve file and `.git/index`
isolation, but they do not by themselves solve task claiming, ports, databases,
semantic conflicts, validation, or cleanup.

## Desired Outcome

Mutating KOTA autonomy agents run in isolated task worktrees by default. Each
run claims exactly one task, creates a prepared worktree on a unique branch,
edits and validates inside that worktree, commits there, rebases or merges
through a KOTA-owned integration gate, resolves bounded textual conflicts when
safe, leaves unresolved work visible, and removes the worktree only after the
result is merged or deliberately abandoned.

Parallel builders can be enabled without multiple agents editing the same
checkout or claiming the same queue item.

## Constraints

- Preserve the existing workflow engine. Do not add a second automation system
  just to manage parallel agents.
- Treat worktrees as a runtime contract, not a prompt convention. Agent cwd,
  tool cwd, repair checks, commit, merge, and cleanup must all know which path
  is the mutable workspace.
- Do not auto-merge into a dirty canonical checkout.
- Do not delete a worktree that has uncommitted, untracked, unpushed, or
  conflicted work.
- Keep `.kota/runs/<run-id>/` and task-queue state discoverable from the
  canonical project path even when edits happen elsewhere.
- Keep rollout staged: builder first, then other mutating autonomy workflows,
  then higher concurrency.

## Done When

- `task-record-architecture-decision-for-worktree-backed-a` records the design
  and conflict policy with external evidence.
- `task-add-workflow-workspace-checkout-contract`,
  `task-add-git-worktree-lifecycle-provider-for-automation`, and
  `task-add-atomic-task-claim-leases-for-parallel-autonomy` establish the core
  runtime primitives.
- `task-run-builder-work-and-repair-inside-task-worktrees` and
  `task-add-merge-gate-and-automated-conflict-resolver-for` make builder runs
  worktree-backed and merge-gated.
- `task-surface-worktree-run-status-and-cleanup-controls` exposes active,
  pending, conflicted, merged, and cleanup states.
- `task-migrate-mutating-autonomy-workflows-to-worktree-po` applies the policy
  beyond builder where mutation is real.
- `task-enable-guarded-parallel-builder-dispatch-with-conf` proves parallel
  builder dispatch with conflict fixtures before increasing real concurrency.
- `task-add-runtime-resource-isolation-hooks-for-parallel-` addresses ports,
  temp roots, setup hooks, and future service/database isolation.

## Source / Intent

Owner request on 2026-06-25: "i want kota automation agents to learn to do all
work in worktrees and then cleanly merge into the repo/project and resolve any
conflicts... that should enable parallel work" followed by "Think it all
thorough more! Research how it's done in other frameworks and harnesses and
loops... find relevant articles and measurements ... then put together a plan
and create tasks for kota to address."

Research inputs include Claude Code worktrees and agent teams, Codex app
worktrees/background automations, GitHub Copilot cloud agent, Google Jules,
Devin MultiDevin, OpenHands, SWE-bench/SWE-bench Pro, AgenticFlict, and
practitioner reports on worktree limits around ports, databases, and semantic
conflicts.

## Initiative

Worktree-backed KOTA autonomy.

## Acceptance Evidence

- A recorded run shows two builder tasks executing from distinct worktree paths
  without editing the canonical checkout.
- A disjoint-change fixture merges both branches and removes both worktrees.
- A textual-conflict fixture either resolves, validates, and merges or leaves a
  pending-conflict artifact with enough context to resume manually.
- `pnpm test` passes for the affected workflow, autonomy, git, and status
  modules.
