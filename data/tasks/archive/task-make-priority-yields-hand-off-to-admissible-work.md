---
status: done
---
# Make priority yields hand off capacity to admissible work

## Evidence And Cause

At `2026-09-13T00:05:21.269Z`, builder
`2026-09-12T23-34-31-972Z-builder-xshnf5` preserved and yielded its P2 parity
task because seven P1 tasks were available. At `00:05:21.392Z` the same run
started again. The daemon journal retains both events; this was not a new task
or a successful priority handoff.

`collectAutonomyContinuationContext` includes unclaimed published tasks as
available work. `runtime-dispatch.ts` stores those task resources as yield
blockers. `resumeSatisfiedContinuationRuns` in `run-state-database.ts` only
looks for already admitted resource requests; absence of a run makes the wait
immediately satisfied. Domain availability and runtime admission therefore
describe different sets of work. Verify the cited record and admission order
before implementing the correction.

## Outcome

Use the existing work-supply, admission and shared run-coordinator owners to
make a deliberate yield an actual capacity handoff. Reconcile published
eligibility and admitted ownership at that boundary, rather than polling the
same judge, sleeping for a fixed time, or introducing a builder-only queue.
Keep task interpretation in repo-tasks/autonomy, not the generic SQLite store.

## Acceptance

Available higher-priority unclaimed work can be admitted and take the released
slot before the yielded run re-enters execution. Preserve the original run,
session, worktree and exclusive task ownership. After restart, the same rule
holds without duplicate admission or lost work. If the preferred work becomes
blocked, completed, removed or genuinely inadmissible, the yield can end;
never wait forever on a stale task snapshot. Healthy converging work is not
preempted merely because priorities changed.

Use an existing composed dispatch/continuation scenario for the unadmitted-work
race and restart behavior, with small owner tests only for distinct policy.
Do not add clocks, a second continuation state machine or repeated steering
tasks. The parity task itself remains owned by its existing builder.

## Result

The shared coordinator now reconciles fresh published supply through ordinary
trigger admission before resuming a deliberate priority yield. Autonomy owns
published task eligibility and scope authority; the generic runtime retains
admission, deduplication, capacity and preserved-run ownership. Dispatcher and
handoff admission share the same builder supply filter.

The composed work-supply journey passed eight cases, including live handoff,
restart without duplicate admission, and blocked/completed/removed/rejected or
disabled preferred work. It verifies retained changes, identical run/session/
workspace, exclusive task ownership, one continuation judgment and eventual
publication. The coordinator, database, lifecycle and queue-restoration suites
passed 100 tests. Additional continuation/executor/dispatcher coverage passed
47 tests; five further runtime-dispatch tests passed, while seven failures
reproduced with the original coordinator/database/lifecycle sources.

Static checks passed. The final normal build rerun could not clean protected
existing dist directories; production compilation was checked separately under
the run directory. Run artifacts retain commands, results and limitations.
The captured incident metadata confirms the cited continuation decision and
same-run lineage; the exact journal event pair was not independently available
in the scoped export. The parity task and its existing owner were untouched.
