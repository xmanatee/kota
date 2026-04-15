---
id: task-fix-dirty-worktree-recovery-attribution-overwrite-
title: Fix dirty-worktree recovery attribution overwrite bug
status: done
priority: p1
area: runtime
summary: handleDirtyCompletion in runtime-dispatch overwrites sourceWorkflow on retry, misattributing dirt to innocent read-only workflows (e.g. attention-digest). The original culprit is lost and recovery targets the wrong workflow.
created_at: 2026-04-15T12:46:15.659Z
updated_at: 2026-04-15T12:59:36.161Z
---

## Problem

When a builder workflow crashes mid-run before committing, it leaves a dirty worktree. On restart, `handleDirtyCompletion` in `runtime-dispatch.ts` records the causing workflow. However, when a recovery-triggered workflow (e.g. `attention-digest`) completes and the worktree is still dirty, the retry branch (~line 132-140) overwrites `sourceWorkflow` and `sourceRunId` with the completing workflow — even if that workflow made no changes. This loses the original attribution and blames an innocent read-only workflow.

Four distinct bugs contribute:
1. Attribution overwrite on retry without a fingerprint check.
2. The fingerprint guard only protects the first attribution; retries bypass it.
3. Recovery queues any `runtime.recovered` subscriber, not a workflow capable of repair.
4. No persisted trace of the true origin once overwritten.

## Desired Outcome

- The `preRunFingerprint` guard applies unconditionally, including on retries, so workflows that did not change the worktree are never attributed as the cause.
- The recovery record is append-only: `sourceWorkflow`/`sourceRunId` are immutable once set; retries append to a `retryAttemptedBy` array.
- Recovery dispatch targets a workflow that can actually repair (commit/stash/reset), not any generic `runtime.recovered` subscriber.
- Read-only workflow classes (digest, explorer, inbox-sorter) are never recorded as causing dirt.

## Constraints

- Do not change the shared `assertRepoWorktreeClean` or `repo-worktree.ts` utilities.
- Preserve the existing `handleDirtyCompletion` contract for callers; changes are internal to the attribution and recovery logic.
- The related `task-builder-dirty-state-recovery` (done) auto-reset behavior must continue working.

## Done When

- A read-only workflow completing against an already-dirty worktree does not overwrite the original `sourceWorkflow` attribution.
- The recovery record preserves the original culprit and logs retry attempts separately.
- Recovery routes to a repair-capable workflow rather than the first `runtime.recovered` subscriber.
- Existing dirty-worktree recovery tests pass; new tests cover the attribution-preservation path.
