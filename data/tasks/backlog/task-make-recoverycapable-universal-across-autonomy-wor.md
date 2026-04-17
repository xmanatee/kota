---
id: task-make-recoverycapable-universal-across-autonomy-wor
title: Make recoveryCapable universal across autonomy workflows
status: backlog
priority: p1
area: core
summary: Design the recovery contract so every workflow can recover from daemon crashes instead of pausing dispatch.
created_at: 2026-04-17T09:02:16.335Z
updated_at: 2026-04-17T09:02:16.335Z
---

## Problem

If the daemon crashes mid-run, only workflows declaring `recoveryCapable: true` are re-queued via `runtime.recovered`. Today that is only `improver` and `attention-digest`. Any other interrupted workflow (builder, decomposer, explorer, inbox-sorter, pr-reviewer) leaves dirty state and the runtime pauses dispatch entirely, waiting for a human. That means most crashes block autonomous progress instead of letting the system heal itself. Builder is the hard case because it holds a worktree and branch-per-task, possibly with an open PR; the others are mostly in-tree edits and should recover cleanly.

## Desired Outcome

Recovery capability is the default posture for autonomy workflows, not an opt-in. Each workflow declares how it resets to a safe base before its first substantive step (stash, branch reset, worktree unwind, etc.) so re-entry after a crash is well-defined. The "pause dispatch on interrupted non-recoverable run" protection is retained only for cases that genuinely cannot be made safe, and the contract for declaring `recoveryCapable: true` is written down.

## Constraints

- Builder's recovery must not blindly resume inside an open worktree/PR; the chosen option (abort + requeue, resume from last committed step, or fail-cleanly) must be explicit and reviewed.
- Recovery steps must be idempotent and must not have network side effects before the reset.
- Do not bypass the dirty-worktree recovery guard documented in `src/modules/autonomy/workflows/AGENTS.md`; extend it if needed, don't reintroduce bounce loops.

## Done When

- A written recovery contract exists (first-step idempotence, no pre-reset network effects, clear reset primitive per workflow family) and is linked from the relevant `AGENTS.md`.
- Every autonomy workflow either declares `recoveryCapable: true` with an appropriate reset step, or documents why it cannot.
- Builder specifically has a chosen and implemented recovery strategy with a passing test covering the crash-mid-run scenario.
- The runtime's "pause dispatch" fallback fires only for the genuinely-unsafe residual cases.

