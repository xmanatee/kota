---
id: task-recover-the-two-stale-builder-claims-blocking-high
title: Recover the preserved daemon-control builder through native-harness conflict resolution
status: ready
priority: p0
area: autonomy
task_class: Platform
summary: Complete the single builder recovery path so a Codex native-tool continuation can resolve bounded textual conflicts, verify the preserved implementation, and integrate the current daemon-control branch without discarding work.
created_at: 2026-08-13T15:51:09.264Z
updated_at: 2026-08-16T08:41:27.748Z
---

## Problem

The original progress-review finding cited two stale builder claims. Current
state disproves that premise: the issue-driven autonomy branch was integrated,
its claim was released, and no physical worktree remains. One real recovery
blocker remains:

- Task: `task-keep-daemon-control-api-responsive-during-workflow`
- Claim: `pending-merge`, run
  `2026-08-14T04-31-59-044Z-builder-18pact`
- Preserved worktree:
  `.worktrees/task-keep-daemon-control-api-responsive-during-workflow-2026-08-13t10-23-52-462z-builder-bojhem`
- Branch commit: `44f5972e0465b2b04ac8e5b0ca658feb555150f4`
- Current merge state: 288 changed index paths and 16 unmerged paths

The prior task `task-make-builder-merge-conflict-recovery-compatible-wi`
declared success by returning `pending-conflict` whenever a native-tool harness
could not honor KOTA's routed file-tool allowlist. That is safe preservation,
but not recovery. Codex builders use native tool control, so the only configured
high-quality harness cannot resolve the conflicts and the continuation returns
to the same pending-merge state.

## Desired Outcome

Complete the existing builder continuation and merge-gate architecture with one
agent-owned path for native-tool harnesses. Run the resolver inside the
preserved worktree, give it the task contract, canonical diff, and exact
textual conflict set, then validate its result before the runtime stages or
commits anything. Resolve and integrate the current daemon-control work through
that path, retaining its original claim and evidence lineage.

## Constraints

- Never force-remove, reset, supersede, or recreate the current worktree. It
  contains the only unique implementation commit for this task.
- Native agents must not write Git metadata. Workflow runtime remains the sole
  owner of staging, merge state, commits, claims, and worktree cleanup.
- Reuse builder recovery continuation, canonical reconciliation, and merge-gate
  ownership. Do not add a manual recovery script, special-case run id, second
  queue, or Codex-only merge implementation.
- Bound native resolution by workspace sandbox plus post-run changed-path,
  conflict-marker, diff, task-scope, and verification checks. If the agent
  changes an undeclared path or cannot establish intent, preserve the work and
  emit `needs-review` with evidence rather than accepting or looping.
- Non-text, delete/modify, rename, and genuinely ambiguous conflicts remain
  fail-closed unless the task evidence makes their intended disposition
  explicit.

## Done When

- A native-tool Codex fixture resolves a real divergent textual conflict inside
  a preserved builder worktree without direct Git metadata access.
- The runtime rejects out-of-scope edits, remaining conflict markers,
  unresolved index entries, missing acceptance evidence, and failed validation
  before merge.
- Existing KOTA-routable harness behavior uses the same merge-gate contract and
  remains covered; there is no fallback resolver path.
- The current `44f5972e` implementation is semantically reconciled with current
  `main`, its focused and task acceptance checks pass, and the result reaches
  canonical `main` through the normal merge gate.
- The daemon-control task moves to done, its claim is terminal, its worktree is
  safely removed, and `workflow state-recovery list --json` reports no pending
  conflict or stale work for this lineage.

## Source / Intent

Corrected from progress-review run
`2026-08-13T15-08-32-984Z-progress-reviewer-d76njw` after a full state audit on
2026-08-16. The audit preserved the one remaining branch and found that the
previous two-claim host-replay premise was stale. This task now owns the actual
mechanism defect and the only unresolved implementation.

## Initiative

Canonical autonomy recovery and responsive daemon control.

## Acceptance Evidence

- A recovery artifact records the current branch and canonical heads, the 16
  original conflicts, resolver transcript, changed-path guard, resolved diff,
  verification commands, merge commit, claim transition, and worktree cleanup.
- A negative native-harness fixture proves that an unrelated edit or ambiguous
  conflict is preserved as `needs-review` and never staged.
