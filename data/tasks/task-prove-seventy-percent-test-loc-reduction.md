---
status: blocked
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

## Retained implementation and validation — September 11

Runtime recovery has reconciled this same run to the bounded contract above.
The runtime export identifies attempt 5, this task resource, the original
workspace/base revision and the revised trigger digest. The previous preserve-
yield rationale is superseded: the p0 evidence-collection task has progressed
to awaiting activation evidence and this task's revised admission is recorded.
The admitted snapshot and runtime authority were not edited.

The existing changes remain intact. Review reused their owner admissions,
retirement rationale and counterfactual results. A newly observed instruction-
truncation failure was repaired by shortening the daemon guidance introduction;
all behavioral and authority rules remain. No new test family was consolidated.
The former task body, including every repair note, is retained byte-for-byte in
this run's `agent/bounded-retained-task-history.md`; its obsolete 70% acceptance
and repeated unfinished-program statements are historical, not this task's scope.

The retained writer changes executable tests from 288,864 to 264,932 LOC
(-23,932), authored support from 21,190 to 21,020 (-170), and production sources
by -1,139 LOC. Generated/vendor exclusions remain 14,885 LOC. These are
unpublished workspace totals against base
`5443aedb5665e6007b43647529b9c6781c54e34d`, not an integrated revision or an
initiative completion claim. The frozen 334,805 baseline and counting recipe
are unchanged. `agent/bounded-changed-surface.json` records the affected-owner
production deltas and current file hashes; prior postcheck-23 evidence supplies
the census. The aggregate percentage work remains with the independent children
and `task-verify-fifty-percent-test-reduction`.

The full static gate and production compilation into a fresh run-owned output
directory pass. All 71 changed test suites have passing final evidence: the
initial run passed 1,455/1,456 checks, and the repaired instruction suite passed
all 197 on rerun. Adjacent verification passed 254/262 checks, including 25 real
Git/SQLite integration-queue and lifecycle checks; three further secret-storage
and metadata-repair suites passed all 31 checks. Those owner checks cover
validation/invariant rejection, retained-work recovery, publication and cleanup
with their declared external ports. They do not replace contained subprocess
validation. No native client source or shared generated contract changed.

The eight adjacent failures remain explicit. Three changed-writer cases stop
at `spawnSync /bin/ps EPERM` before rejection/publication oracles. Five workflow
DLQ journeys time out; a representative admission diagnostic shows failed
runtime allocation and missing pre-execution metadata, and observing the real
listener confirms `listen EPERM` in its port probe. Temporary diagnostic edits
were restored. The ordinary build wrapper cannot remove protected `dist`
directories; fresh compilation proves emission but not asset packaging. Existing
onboarding journey failures are likewise not claimed as successful execution.
The supplied issue export contains no applicable changed-writer evidence.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Runtime-owned contained validation and integration evidence for this retained changeset, including changed-writer validation rejection, invariant rejection, successful publication/cleanup and onboarding composition; equivalent attributable scoped exports are accepted.

The runtime must provide an authorized validation execution profile supporting
its own process observation and port probes, or equivalent attributable evidence,
then reconcile this writer with current main and rerun invalidated checks through
its normal integration owner. It must record the resulting revision and safe
claim/workspace cleanup. This agent cannot perform runtime-owned rebase,
publication or launching-daemon activation; no permission change, manual capture,
credential absence or host capability absence is inferred from sandbox denial.
No integration or full task completion is claimed. Preserve this run, its task
resource and every retained change until those prerequisites are satisfied.
The blocker is the remaining bounded execution/publication acceptance, not the
retired repository-wide reduction target. No sibling task was changed.

## Integration conflict repair — September 11

Resolved the 38 runtime-reported conflict paths against canonical revision
`b696d13f3`, preserving the retained owner-test consolidation and newer runtime
contracts. Canonical guidance and the frozen verification baseline remain;
retired syntax-lint tests stay deleted, while canonical write-failure rollback
coverage remains. The reconciled tests retain explicit configuration rejection,
nested tool authority, event failure reentry, transactional finalization,
editor alias/undo behavior, readable web-source evidence and scoped review state.
No Git metadata, publication state, sibling task or out-of-scope source was edited.

Focused validation: the initial 22 conflict suites passed 572 of 574 tests.
Corrected the two merged fixtures (global review state-directory binding and
onboarding readiness after clearing the failure port); both suites then passed
alongside instruction-loading verification: 301 tests across three suites.
Every conflict suite now has passing evidence, and the instruction-size guard
passes. Biome passes for all 26 surviving conflict TypeScript files; task
validation passes. Production typechecking passes.

The repository test typecheck remains blocked by seven errors outside this
repair's permitted paths: retired scheduler APIs in `src/init.integration.test.ts`
(four errors), the obsolete scheduler port in
`src/modules/github-webhook/github-webhook.test.ts` (two errors), and removed
`SemanticTasksStore.flush` in `src/modules/repo-tasks/scope-stores.test.ts`
(one error). Runtime validation repair must handle those files under its own
scoped authorization. These errors are not a passing static gate. The earlier
workspace totals remain historical pre-integration observations. Runtime still
owns staging, continuation, complete validation, publication and final cleanup;
this repair does not claim an integrated revision or task completion.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-11T10:24:11.823Z -->
