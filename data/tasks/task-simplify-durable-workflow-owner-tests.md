---
status: open
priority: p1
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
