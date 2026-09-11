---
status: open
priority: p1
depends_on: [task-prove-seventy-percent-test-loc-reduction]
---

# Simplify shared agent-loop and harness contract verification

## Scope

Own `src/core/loop` (4,532 test LOC), `src/core/agent-harness` (4,415) and directly
related shared session test support. Provider adapter tests are consumers handled
by the next task. Keep workflow execution and tool-execution owner suites separate.

## Required Outcome

Retain semantic loop continuation, streaming results, truthful usage, cancellation,
session isolation and supported/unsupported capability handling. Consolidate
duplicated callback choreography and neutral-message fixture variants around their
actual shared owner. Keep real envelope parsing and boundary failures where static
types cannot establish runtime correctness.

Do not build a universal harness simulator or expose private hooks solely for
tests. `task-preserve-and-recover-agent-sessions-across-harnesses` owns new
persistence/resume behavior; preserve its current contract and avoid implementing
a competing session store here.

## Acceptance

Apply `task-verify-fifty-percent-test-reduction` rules. Publish a bounded
loop/harness cleanup and clear consumer contract, run focused shared checks, and
report test/support deltas. Shared tests must only demand capabilities their
implementations actually declare.
