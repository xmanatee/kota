---
status: dropped
---

# Make TaskClaim the sole active-work authority

## Problem

KOTA stores a `doing` task state while separately owning execution through
`TaskClaim`, workflow runs, worktrees, and recovery dispositions. An automated
run can therefore be active while its task remains in `ready/`, `doing/` is
empty, and clients disagree about whether the task is available or in progress.

## Desired Outcome

Make the existing `TaskClaim` the sole active-work authority. Persist product
queue readiness/outcomes separately, derive active operator state by joining
the task, claim, run, worktree, and recovery disposition, and remove the
overlapping persisted `doing` mechanism.

## Constraints

- Do not add another execution-claim, reservation, watchdog, or status store.
- An unclaimed ready task is dispatchable; a claimed ready task is projected as
  claimed/running and cannot be dispatched again.
- Preserve claim leases, task-content binding, worktree lineage, pending merge,
  decomposition, preserved yield, and recovery safety.
- Migrate or disposition any current `doing/` task data, then delete the state,
  directory-specific behavior, schemas, client fields, fixtures, and docs.
- Remove claim schema-v1 compatibility after supported current state is
  converted; do not retain a permanent old-claim reader.
- Every client consumes one shared `TaskWorkProjection` rather than joining raw
  stores independently.

## Done When

- Queue state has no persisted `doing` value or directory.
- Dispatcher excludes active claims from ready work and duplicate dispatch is
  impossible across restart or concurrent admission.
- CLI, inbox, web, mobile, Apple, shared UI, digest, and recovery render the
  same derived lifecycle: ready, claimed, running, recovering, integrating,
  blocked, done, or dropped as applicable.
- Expired claims and unambiguous terminal worktrees reconcile through the
  existing lifecycle owner; ambiguous evidence remains preserved for review.
- Current claim state survives restart and legacy claim parsing is absent.

## How We Will Know

- Claimed work is shown once as active and cannot be dispatched again across
  concurrent admission or restart.
- Interrupted work converges through the production recovery owner.
- Every operator client consumes the same derived active-work projection, and
  the persisted `doing` mechanism is removed with its final caller.

## Source / Intent

Owner-approved correction from the 2026-08-24 audit. Live status showed one
active builder and active dirty worktree while the canonical queue had zero
tasks in `doing`. Recheck found the existing `TaskClaim` already carries the
ownership and lease data a second execution primitive would duplicate.

## Initiative

One authoritative task and automation lifecycle.

## Acceptance Evidence

- Production/restart fixture covering claim, run, worktree, recovery, pending
  merge, terminal integration, and duplicate-dispatch rejection.
- Rendered CLI/web/mobile/Apple evidence for the same active task.
- Structural report proving `doing` state and claim-v1 compatibility are gone.

## Disposition

Dropped because the named `TaskClaim` mechanism no longer exists. Durable run
metadata plus daemon-owned logical resources replaced it; a builder claims
`task:<id>` atomically in `RunStateDatabase`, and its immutable trigger binds
the task path, state, revision, and digest. The repo `doing` state remains an
ordinary human queue state and is not automation ownership. Recreating
`TaskClaim` to satisfy this task would add the duplicate authority it opposed.
