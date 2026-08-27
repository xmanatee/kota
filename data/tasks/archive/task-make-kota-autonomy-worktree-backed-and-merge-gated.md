---
status: dropped
---

# Make KOTA autonomy worktree-backed and merge-gated

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

- The required initiative slices named in `## Done When` are all in
  `data/tasks/archive/`, including the architecture decision, workspace contract,
  worktree lifecycle provider, atomic task claims, builder worktree execution,
  merge gate/conflict resolver, status/cleanup surface, mutating-workflow
  migration policy, guarded parallel dispatch, and runtime resource isolation.
- `task-enable-guarded-parallel-builder-dispatch-with-conf` records the
  disjoint merge-gate fixture, conflict fixture coverage, serialized
  merge-lock coverage, and parallel-builder metrics artifact coverage.
- `src/modules/autonomy/workflows/builder/workflow-worktree-mode.fixture.test.ts`
  proves a builder run writes and commits inside a task worktree while the
  canonical checkout remains clean.
- On 2026-06-29, the builder worktree mode default was corrected so missing
  config enables branch-per-task worktrees and two-run builder concurrency;
  `modules.builder.branchPerTask: false` remains the explicit serial opt-out.
- On 2026-06-29, builder runtime-resource cleanup was added after successful
  commit/task release, releasing port leases and removing only the exact
  generated `.kota/tmp/<run-id>` temp root.
- On 2026-06-29, stale builder temp roots and the stale
  `task-resolve-security-review-workflow-scan-diagnostics:2026-06-29T01-12-31-451Z-builder-8ai2pp`
  port lease were removed; `.kota/tmp` is empty and
  `.kota/runtime-resources/builder-port-leases.json` has no active leases.

## Disposition

This strategic tracking record is retired because initiatives are not executable tasks. Its child tasks retain the actionable outcomes and dependency structure.
