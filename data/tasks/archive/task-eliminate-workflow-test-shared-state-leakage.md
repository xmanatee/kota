---
status: done
---

# Eliminate workflow test shared-state leakage

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

## Current Progress

Stage 9 removed ambient provider/bus/scheduler teardown from hosted runtime
composition, made module activation disposable, and made interactive restart
await host disposal. A production workflow-trial check exposed and corrected
a split provider authority between its runtime loader and standalone host.
Concurrent hosts now dispose independently, and the 279-test changed-owner set
passes in parallel. Stage 10 deleted the shadow workflow and HTTP runtimes.
Stage 16 additionally made session-environment resource cleanup awaitable and
propagated disposal through loop, browser, workflow, and channel owners.

Stage 16 completed the remaining isolation work at the owners exposed by the
consolidated run. Session environments now have awaitable disposal instead of
fire-and-forget close behavior. Workflow repair tests assert the public error
contract instead of a stale private result shape. The autonomy issue source
again subscribes to eval regressions. Security-review scenarios commit their
declared source state before isolated checkout and use an explicit stable run
identity for replay, so they no longer depend on an ambient worktree or create
colliding sandbox branches.

The original concurrency behavior and the affected daemon, module, Telegram,
workflow, and autonomy owners now pass within the full parallel suite. No
sleep, retry, global serial mode, quarantine, or reset catalog was added.

## Initiative

Deterministic, trustworthy workflow runtime verification.

## Acceptance Evidence

- The lifecycle/repair/eval/security-review regression group passed 39 tests in
  four files after the owner fixes.
- `pnpm test` passed 12,180 tests in 1,291 files and skipped 14 tests in one
  file. The run used the ordinary parallel configuration and no retries.
- `pnpm check:fast` passed both TypeScript projects, Biome, and task
  validation.
