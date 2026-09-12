---
status: done
---

# Consolidate durable workflow tests around their production owners

## Scope And Evidence

Within `src/core/workflow`, own tests and direct support for RunStateDatabase,
RunCoordinator, RunLifecycle, RunSandboxManager, IntegrationQueue, resources,
restart recovery and publication. Start with `run-state-database.test.ts`
(1,315 LOC in the retained census), `run-coordinator.test.ts` (841), lifecycle
and integration suites. Step execution and trigger-host tests belong to the
separate step/trigger task; do not absorb them.

## Required Outcome

Trace each repeated lifecycle scenario to its real state, process or Git owner.
Keep the strongest public observation and remove consumer copies that prove no
additional boundary. Reuse existing real SQLite/Git fixtures; replace copied
state-machine behavior, not useful controlled clock/process ports. Do not create
a universal lifecycle DSL or mechanically merge unrelated scenarios into one test.

Retain evidence for admission exclusivity, atomic state/publication, cancellation,
restart recovery, resource release, latest-head validation and ambiguous-work
preservation. Static types or call counts cannot replace these runtime guarantees.
Fix adjacent ownership defects only when needed to simplify the named contracts.

## Acceptance

Follow the shared rules in `task-verify-fifty-percent-test-reduction`. Publish a
bounded kernel simplification, a short scenario-to-owner explanation and test/support
deltas. Run affected owner checks and the existing writer integration scenario when
publication changes. Unrelated test families and the global percentage do not gate
this slice. Its helpers are then available to dependent consumer cleanup.

## Completion

Consolidated the durable kernel tests using their existing real SQLite and Git
fixtures. No production or authored-support code changed; no tests were disabled
or moved into support. The four edited test files total 2,848 → 2,627 LOC (-221):
`integration-queue` 639 → 524, `run-coordinator` 994 → 957,
`run-lifecycle` 970 → 941, and `run-publication-recovery` 245 → 205.
These are local candidate deltas, not a published global reduction claim.

- RunCoordinator now owns automatic publication retry with a controlled clock,
  durable pending/delivered observations and an unchanged attempt identity. Removed
  the weaker manual-drain retry and the duplicate timer case in publication recovery.
  The pre-ack crash journey still reopens SQLite and proves downstream admission
  happens once; its coordinators now dispose before their databases close.
- Scope cancellation remains exercised through the runtime stop consumer in
  `run-coordinator-scope-pause.test.ts`, including an unaffected sibling scope.
  Removed the equivalent direct coordinator scenario. Capacity contention, child
  waits, active cancellation, unsafe cleanup and disposal cases remain distinct.
- RunLifecycle's retained-writer retry now also asserts the rejection reason,
  unchanged canonical head and preserved checkout contents. Removed the separate
  rejection-only case. Reader/writer finalization, restart, ambiguous missing work,
  cancellation cleanup and publication-journal recovery remain covered.
- IntegrationQueue's four dirty-tree cases share one focused parameterized test:
  writer/canonical edits before/during validation. All four stimuli remain, with
  stronger file-content preservation and unchanged-head observations. Latest-head
  validation, conflicts, serialization, cancellation and branch binding remain
  separate cases.
- RunStateDatabase remains the authoritative SQLite proof for admission fencing,
  atomic state/outbox rollback, restart resource ownership and acknowledgement.
  Its current 803-line suite was already smaller than the task's historical census;
  the remaining scenarios establish distinct persistence guarantees. Sandbox and
  resource allocators retain their Git safety and real SQLite allocation tests;
  process-tree restart tests retain their real process boundary.

Validation: all 114 tests across eight selected owner suites passed after the
change (database, coordinator, scope pause, lifecycle, integration queue, sandbox,
resources and publication recovery). Production/test typechecks, full source
lint, task validation and generated client-binding checks passed. The initial nine-suite baseline passed 117 tests; its two unchanged
process-tree restart cases failed with `spawn-failed`. The existing native writer
integration scenario was attempted and failed at `listen EPERM` on 127.0.0.1.
Neither unavailable process/host check is claimed as passing. Passing lifecycle
and integration-queue tests exercise actual Git publication and recovery without
changing those external boundaries. No native client or shared contract changed.
