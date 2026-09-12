---
status: done
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

## Completion

Consolidated shared loop fixtures and harness capability admission. Loop cases now
inspect tool-result continuation, hook/failure guidance and persisted transcript
bytes. The neutral type catalog is replaced by runtime decoder acceptance/rejection;
precise types remain authoritative for trusted callers. Provider adapters and the
existing persistence/recovery implementation remain unchanged. Harness guidance
states which shared contracts adapter tests consume.

Local frozen-recipe counts: loop tests 3,280 -> 2,951; harness tests 5,410 -> 5,230.
Combined reduction: 509 LOC. Authored support remains 30 LOC; production source and
exclusions unchanged. These are candidate counts, not the published aggregate.

`pnpm check:fast` passed. Shared checks passed 479/481 tests across 21 files,
including loop behavior, runner admission, neutral decoding, usage and real
cross-process continuity. The two failures are unchanged instruction-size guards
for `src/core/modules/AGENTS.md` (8,581 bytes) and `src/core/workflow/AGENTS.md`
(8,379 bytes); both match HEAD. Changed harness guidance passes at 7,947 bytes.
Run `2026-09-12T06-41-13-628Z-builder-7r8y8b` retains the logs, count comparison and
behavior-family rationale in its ordinary agent summary.
