# Dirty-worktree recovery misattributes the causing workflow

## Symptom

Daemon logs show `attention-digest` blamed for a dirty worktree whose
actual contents (new `src/modules/tracing/`, `task-add-workflow-execution-tracing`
moved `backlog → done`, OTEL deps added to `package.json`) are clearly the
output of a builder/developer workflow, not a read-only digest. Recovery
then runs `attention-digest` (the matched consumer of `runtime.recovered`),
which cannot clean the worktree, and dispatch pauses.

## What actually happened (reconstruction)

1. An earlier builder workflow produced the tracing-task edits but never
   committed — likely crashed or was killed mid-run.
2. On its completion `handleDirtyCompletion` set `recovery = { sourceWorkflow: builder, attempts: 0, ... }`.
3. Daemon restarted. `queueRecovery()` queued `attention-digest` (the workflow
   wired to `runtime.recovered`), attempts → 1.
4. `attention-digest` completed, worktree still dirty.
   `handleDirtyCompletion` ran with `existing.attempts >= 1` → took the
   branch at `src/core/workflow/runtime-dispatch.ts:132-146` that
   **overwrites `sourceWorkflow` and `sourceRunId` with the current
   completing workflow**. Attribution was lost.

## Root-cause bugs

1. **Attribution is overwritten on retry without a causation check.**
   `runtime-dispatch.ts:132-140` rewrites `sourceWorkflow` to the currently
   completing workflow regardless of whether that workflow touched the tree.
   If the recovery workflow is a read-only digest, it should never be
   recorded as the cause.

2. **The fingerprint guard only protects the first attribution.**
   `runtime-dispatch.ts:123` skips attribution when
   `!existing && worktree.fingerprint === preRunFingerprint`. Once
   `existing` is set, the guard is bypassed and a fingerprint-unchanged
   workflow can still be blamed on retry.

3. **Recovery runs the same workflow that supposedly caused the dirt.**
   Anything matching `runtime.recovered` is queued. A digest or read-only
   workflow cannot clean the tree; recovery should route to a workflow
   that actually knows how to repair/commit/stash, or explicitly discard.

4. **No persisted trace of the true origin.** Once overwritten, the real
   culprit (the crashed builder) cannot be recovered from logs. The
   recovery record should preserve the original `sourceWorkflow`/`sourceRunId`
   and only append retry metadata.

## Suggested direction

- In `handleDirtyCompletion`, apply the `preRunFingerprint` guard
  unconditionally (even when `existing` is set) so innocent workflows
  are never blamed.
- Treat the existing recovery record as append-only: add
  `retryAttemptedBy: Array<{ workflow, runId, at }>` rather than
  overwriting `sourceWorkflow`.
- Gate dirty attribution on workflow class: workflows declared read-only
  (digest, explorer, inbox-sorter in dry-run mode) should never be
  recorded as causing dirt.
- Recovery dispatch should target a dedicated repair workflow, not any
  workflow subscribed to `runtime.recovered`.

## Also flagged by this incident

The builder workflow that produced the tracing module completed its
semantic work (task file moved to `done/`, code written, tests passing)
but did not commit. Investigate whether the commit step is missing from
that workflow or whether the run was terminated before reaching it. If
the former, that is the upstream fix; the attribution bug would then
be a defense-in-depth concern only.
