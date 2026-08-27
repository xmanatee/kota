---
status: done
---

# Fixture dependency for auth-walled source access

## Problem

The research-retry replay writes a blocked task whose external browser-state
precondition remains unsatisfied.

## Desired Outcome

The fixture working tree contains the dependency target so task validation can
check the explicit edge.

## Constraints

- Keep this task fixture-local; it only exists to satisfy dependency validation
  for the recorded blocked task.

## Done When

- The replay fixture can validate task dependencies without a missing-target
  error.

## Source / Intent

Fixture support record for `research-retry-agent-call-replay`.

## Acceptance Evidence

- `pnpm vitest run src/modules/eval-harness/replay-smoke.test.ts -t 'research-retry-agent-call-replay'`
  passes.
