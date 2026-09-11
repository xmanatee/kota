---
status: open
priority: p1
depends_on: [task-collapse-root-integration-and-test-support]
---

# Integrate retained verification simplifications without expanding the scope

## Outcome

Review, repair and publish the useful changes already retained by builder run
`2026-09-08T22-45-09-535Z-builder-hjhox7`. This is a bounded integration task,
not an instruction for one builder to finish the repository-wide reduction.
The owner now requires 50% overall reduction, with 70% a stretch goal; the
aggregate contract belongs to `task-verify-fifty-percent-test-reduction`.

## Retained Work And Recovery

Keep this task id so the original run can reconcile its changed contract and
adopt its owned workspace through ordinary recovery. Its sandbox allocation is
`2026-09-08t22-45-09-535z-builder-9cf8a78f014841c477fc6aa35a30bd3c3bfed1290af9b002bf763626a689410a`
under `.kota/runtime/` and `.kota/runtime/worktrees/`. Read its run metadata,
latest repair summary, critic findings, diff and validation evidence. The
September 11 postcheck-22 inventory records 265,690 test LOC versus the frozen
334,805 baseline; it is a work-in-progress snapshot, not a published result.

The earlier immutable admission still requires 70%. A canonical task edit does
not update that admission or restore its ephemeral Codex conversation. Reconcile
through the runtime's retained-run recovery before executing this revised scope;
never rewrite the database, admitted snapshot, or another running writer's files.
Do not start a duplicate writer or discard the retained work. If that ownership
cannot be recovered, preserve it and report the precise recovery prerequisite.

## Required Changes

- Restrict implementation to the existing changed owners and defects necessary
  to make that changeset publishable. Stop opening unrelated test families to
  chase a percentage; the dependency-linked children own the remaining cleanup.
- Check actual behavior preserved by deletions and implicated production changes.
  Reuse prior owner-level findings and valid evidence. Fix concrete regressions;
  remove unnecessary changes from this writer only when their removal is justified.
- Reconcile with current main through runtime-owned integration and rerun checks
  invalidated by that reconciliation. Preserve source-authority, sandbox and
  publication guarantees. The reported `/bin/ps` denial is not a passing writer
  probe: distinguish an execution-profile problem from a product failure, and
  obtain the owning runtime's authorized validation without weakening isolation.
- Record the integrated revision, before/after test and support totals, affected
  production-owner deltas, and any precise follow-up owned by a child task.
  No fresh repository-wide census/admission dossier is required after each repair.

## Done When

The retained changes are integrated with valid changed-surface evidence, task and
claim cleanup completes safely, and no useful work is silently lost. This slice
may finish below 50%; it must not claim the overall initiative is complete.
Do not restore or mark the retired strategic anchor done. Other child tasks and
the final percentage audit must remain independent, dispatchable work.
