---
status: done
---

# Simplify workflow step and trigger verification without copying the kernel

## Scope

Own remaining workflow executor, agent/repair-step, event-batch, schedule/watch,
definition and step-validation tests under `src/core/workflow`, excluding the
durable kernel owned by the predecessor. Inspect `event-batches.test.ts` (802
LOC), executor fixtures, repeated combinations and numbered support families.

## Required Outcome

Retain observable step outputs, cancellation propagation, continuation decisions,
trigger admission/deduplication and resume semantics at their owning boundaries.
Remove repeats of the predecessor's queue/resource/integration lifecycle. Exercise
generic behavior over representative inputs rather than a Cartesian product of
workflow names, configuration numbers and private step sequences.

Use the existing production executor and narrow external ports. Do not replace
several test files with one scenario interpreter or invent a second fake runtime.
Keep genuinely distinct ordering, delivery and failure semantics explicit; code
that merely looks similar is not necessarily duplicate coverage.

## Acceptance

Apply `task-verify-fifty-percent-test-reduction` rules. Demonstrate the changed
executor/trigger contracts with focused checks, remove orphan support, and report
owner-level test/support deltas. No repository-wide reduction or audit is required
to finish this task. Do not modify autonomy workflow contracts in this slice.


## Completion

Simplified six executor/watch test files using the existing production executor,
run store and context fixture. Local candidate test LOC is 2,285 → 1,731 (-554),
using the frozen recipe's physical-line counting and test-file classification.
Authored-support, generated/vendor exclusions and production-code deltas are zero.
This is not a published repository-wide reduction claim.

- Retry and explicit resume retain separate consumer journeys. Each now checks
  execution selection, replayed outputs, new previous output and persisted source
  identity together. Removed the separate output/lineage reruns and their orphaned
  metadata readers and copied context/definition builders; reused
  `run-executor-test-fixture.ts` without adding support. First-step retry/resume,
  invalid prerequisites, missing source and `rerunOnRetry` remain distinct.
- The continue-on-failure consumer now observes the failed result in its next step,
  persisted failure metadata and warning status in one execution. Fatal failure
  and successful optional work remain separate. Timeout tests cover both cooperative
  cancellation and unresponsive work, skipped successors, error classification and
  absence of premature alerts. Removed repeated status-only runs and the literal
  default-timeout assertion; heartbeat, await-event and foreach deadlines remain.
- Output-schema cases retain wrong-type and missing-property inputs with persisted
  warning assertions. Watch delivery, pending-buffer visibility and debounce now
  share one scenario that also checks duplicate-file suppression. Nonmatching
  paths, multiple patterns, stopping and subscription cleanup remain separate.
- Retained event-batch cases: count, nested grouping, strict inputs, age versus
  idle flush, ordinary versus route-owned restart, scope/manual flush, two overflow
  policies and schema provenance detect distinct delivery failures. Agent repair,
  continuation stream/poll checkpoints and normalized definition/step validation
  likewise have distinct owners and were not deleted for size. Current support
  has no obsolete numbered family to remove; `run-executor-group-support.ts` is
  production group execution, not test support. No kernel or autonomy contract
  was changed, and existing scoped guidance remains accurate.

Validation: 210 tests passed across 21 executor, agent-output/timeout, continuation,
repair, watch/schedule, definition/agent-validator, nested-step, trigger admission
and idempotency suites. After retaining the additional unresponsive timeout input
and completing typed watch fixtures, the four affected suites passed all 28 tests.
`pnpm check:fast` passed against the final changeset, including production/test
typechecks, lint, task validation and generated client bindings. These proofs exercise outputs, actual run evidence,
cancellation and trigger effects rather than a replacement interpreter.

The initial baseline passed 48 tests and failed all 10 event-batch execution cases.
A scoped diagnostic probe traced the failure to `No run-owned local port range is
available`; terminal finalization then reported missing first-run metadata. The
sandbox returned `EPERM` on a direct loopback-listen probe used to diagnose the
allocator limitation. No batch
execution success is claimed. Diagnostic edits were removed, leaving the full
802-line batch suite unchanged. No native client or shared contract changed;
full release/live-model checks were not required for this test-only slice.
