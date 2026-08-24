---
id: task-eliminate-workflow-test-shared-state-leakage
title: Eliminate workflow test shared-state leakage
status: backlog
priority: p1
area: core
task_class: Platform
depends_on: [task-make-builder-continuation-evidence-driven-and-prio]
summary: Isolate runtime roots, stores, ports, clocks, globals, and teardown so workflow concurrency tests pass under full-suite and randomized execution.
created_at: 2026-08-24T02:13:51.982Z
updated_at: 2026-08-24T02:13:51.982Z
---

## Problem

The full 1,411-file suite failed the same-named workflow concurrency-group
test because only one of two expected run directories appeared. The focused
test then passed ten consecutive isolated runs. This indicates test-order,
shared-state, timing, or teardown leakage rather than a deterministic local
assertion failure.

## Desired Outcome

Make workflow and daemon tests hermetic under full-suite parallelism and
randomized ordering. Each test owns its runtime root, queues, event stores,
ports, clocks, registries, environment, processes, timers, and teardown
barrier, and concurrency assertions observe explicit lifecycle state rather
than racing immediate directory counts.

## Constraints

- Land after the active builder-continuation task because it currently changes
  workflow concurrency and overlapping tests.
- Diagnose the leaking owner; do not hide the failure with retries, longer
  arbitrary sleeps, global serial execution, or quarantine.
- Prefer injected runtimes and explicit lifecycle events over reset hooks for
  process-global state.
- Keep a bounded diagnostic retry mode only if it still reports the underlying
  flaky failure and captures order/handle evidence.

## Done When

- The original failing test asserts two serialized lifecycles through explicit
  run events/state and remains sensitive to real same-group overlap.
- The affected shard passes repeated randomized and parallel runs.
- Full `pnpm test` passes repeatedly without retries or hidden quarantine.
- A between-test leak detector reports no surviving servers, child processes,
  timers, modified globals, runtime roots, or port reservations.

## Source / Intent

Fresh 2026-08-24 validation: 12,982 tests passed, 14 skipped, and one failed at
`src/workflow-runtime.integration.test.ts` in the named concurrency-group
case; the exact test passed 10/10 isolated reruns. The owner approved fixing
the isolation defect rather than retry-greenwashing it.

## Initiative

Deterministic, trustworthy workflow runtime verification.

## Acceptance Evidence

- Full-suite failure transcript plus repeated randomized affected-shard and
  full-suite passing transcripts.
- Leak-detector artifact naming the original shared owner and proving cleanup.
- Intentional concurrency regression showing the corrected test still fails
  when same-group serialization is broken.
