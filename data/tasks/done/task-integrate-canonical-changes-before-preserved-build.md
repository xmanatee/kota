---
id: task-integrate-canonical-changes-before-preserved-build
title: Integrate canonical changes before preserved builder continuation
status: done
priority: p1
area: architecture
task_class: Platform
summary: Checkpoint preserved builder work and reconcile canonical divergence before an agent resumes, so recovery never extends obsolete code or defers known conflicts to the final merge gate.
created_at: 2026-08-14T16:28:47.409Z
updated_at: 2026-08-15T02:45:08.715Z
---

## Problem

Builder recovery currently reuses a preserved dirty worktree and starts the
full builder agent without first integrating changes made to canonical `main`
since that worktree's base commit. Recovery records `branchBehind`, but treats
it as observability only. The eventual merge gate reconciles canonical after
the implementation and repair loop have already reasoned over obsolete code.

Live run `2026-08-14T04-31-59-044Z-builder-18pact` proves the impact. Its
preserved worktree is 21 commits behind `main`; the recovery agent has changed
170 files, with 21 paths also changed on canonical. Those overlaps include the
four escalator workflow files deleted by commit `634e84ef0`. The agent spent
15 completed repair turns and more than six hours migrating and validating
code against that stale architecture before the final merge gate could expose
the divergence.

## Desired Outcome

Make canonical reconciliation a required recovery phase before any general
builder or repair agent resumes preserved work. The runtime checkpoints the
exact preserved changes on their existing task branch, compares them with the
current canonical head, integrates non-conflicting canonical changes, and
routes only actual conflict paths through the existing merge-resolution
mechanism. The resumed agent then sees the current architecture, task queue,
instructions, and validation contracts.

## Constraints

- Preserve every tracked and untracked worktree change before attempting
  integration. Never reset, force-remove, or discard ambiguous work.
- Runtime owns staging, checkpoint commits, merge state, and claim metadata;
  native agents continue to receive read-only Git metadata.
- Reuse the existing worktree merge gate and conflict resolver. Do not add a
  second rebase engine, generic stash fallback, or a separate recovery branch
  type.
- Keep the original base commit as provenance and record the canonical commit
  integrated for this continuation. Do not rewrite or obscure lineage.
- If changed-path overlap is ambiguous or conflict resolution fails, preserve
  the checkpoint and return `needs-review`; do not start the general builder.
- Run task and source validation after canonical integration and before agent
  execution so deleted workflows, changed instructions, and newer policy
  gates are authoritative.

## Done When

- A preserved recovery candidate cannot enter the builder agent step until its
  branch contains the current canonical head or has an explicit preserved
  `needs-review` disposition.
- Dirty tracked and untracked changes are captured in one evidence-backed
  checkpoint before integration, and claim/worktree metadata records original
  base, checkpoint, integrated canonical head, conflicts, and disposition.
- Non-overlapping divergence integrates without an agent; overlapping paths
  invoke the existing conflict resolver with only those paths and rerun
  validation before continuation.
- Canonical deletion or rename of a path changed by preserved work cannot be
  silently resurrected by the resumed builder.
- The final merge gate remains authoritative for concurrent commits arriving
  after continuation, but does not rediscover divergence that existed before
  the agent started.
- Status and state-recovery projections explain whether a candidate is
  checkpointing, reconciling canonical, conflict-blocked, or ready to resume.

## Source / Intent

Created by the 2026-08-14 daemon health audit while preserving the healthy
active recovery run. Evidence comes from
`.kota/runs/2026-08-14T04-31-59-044Z-builder-18pact`, its worktree metadata,
and the live Git comparison: base `f5d712e1`, canonical `01c35346`, 21 commits
behind, 170 changed paths, and 21 path overlaps. The run remained active with
fresh Codex events, so it was not interrupted; this task fixes the recovery
ordering that made the run unnecessarily broad and conflict-prone.

## Initiative

Reliable builder worktree recovery and bounded autonomous delivery.

## Acceptance Evidence

- A recovery fixture preserves dirty tracked and untracked work while
  canonical independently changes unrelated paths; evidence proves checkpoint,
  automatic integration, validation, and agent start on the current head.
- A deletion/rename conflict fixture proves the general builder does not run
  until the existing conflict resolver dispositions only the overlapping
  paths, with no resurrected canonical deletion.
- A failed-resolution fixture proves the checkpoint, claim, worktree lock, and
  conflict artifact survive with `needs-review` and no data loss.
- A live recovery artifact records zero pre-existing canonical-behind commits
  when the builder agent starts and a later canonical commit is handled once
  by the final merge gate.
