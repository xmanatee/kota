---
id: task-make-taskclaim-the-sole-active-work-authority
title: Make TaskClaim the sole active-work authority
status: backlog
priority: p1
area: architecture
task_class: Platform
depends_on: [task-complete-the-terminal-project-to-scope-migration]
production_replacement: true
summary: Remove overlapping persisted doing state and derive active task status from the existing TaskClaim, run, worktree, and recovery projection.
created_at: 2026-08-24T02:13:42.524Z
updated_at: 2026-08-24T02:13:42.524Z
---

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

## Production Replacement Proof

oldBoundary: persisted doing task state plus client-specific joins of ready tasks, task claims, workflow runs, worktrees, and recovery records
replacementOwner: TaskClaim authority and one TaskWorkProjection consumed by dispatch and every operator client
liveIngresses: task admission and claim acquisition | workflow run and worktree lifecycle | CLI inbox web mobile and Apple task rendering
restartIngresses: active claim restoration | interrupted workflow recovery | stale worktree reconciliation
observableEffect: claimed work is shown once as active, is never dispatchable, and converges to one terminal task outcome across live and restored state
productionEntrypoints: src/modules/autonomy/task-claim-files.ts | src/modules/repo-tasks/repo-tasks-domain.ts | src/modules/daemon-ops/task-queue-projection.ts | src/modules/git/worktree-lifecycle.ts
productionTests: src/modules/autonomy/task-claim-races.test.ts | src/modules/repo-tasks/repo-tasks.test.ts | src/modules/daemon-ops/index.test.ts | src/modules/git/worktree-lifecycle.test.ts
retiredPathCheck: persisted doing state, claim schema-v1 parsing, and client-owned active-work joins are unreachable
evidenceArtifact: .kota/runs/taskclaim-active-work-migration/evidence/artifacts/production-replacement-proof.json

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
