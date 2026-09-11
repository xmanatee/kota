---
status: open
priority: p1
depends_on: [task-simplify-durable-workflow-owner-tests]
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
