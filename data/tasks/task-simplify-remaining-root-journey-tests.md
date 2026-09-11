---
status: open
priority: p1
depends_on: [task-simplify-autonomy-workflow-consumer-tests, task-simplify-workflow-operator-tests, task-simplify-provider-adapter-contract-tests, task-simplify-channel-boundary-tests]
---

# Remove root journey duplication after owner-level consolidation

## Scope And Evidence

Own direct `src/*.test.ts` and `src/*.integration.test.ts` journeys and root
test support, not nested owner suites. The retained inventory has 16,286 LOC
across 67 root files; start with `scope-onboarding-e2e.integration.test.ts`
(1,394) and `workflow-step-executor-agent.integration.test.ts` (1,110).
Reuse completed root-cleanup evidence rather than repeating its entire
support/export inventory.

## Required Outcome

After predecessors integrate, trace each retained root journey to the additional
packaging, process, cross-module, policy or operator failure it uniquely catches.
Delete owner-case repetitions; keep concise end-to-end wiring proof. Collapse
source/built variants only where they prove the same thing, preserving actual
installed-package/public-API tests for packaging differences.

Remove abandoned helpers with their final consumer. A setup wrapper may compose
real owners, but must not interpret workflow execution or fabricate terminal
results. Keep temporary files attributable and do not move tests into uncounted
scripts. Do not broadly rerun all portfolios after each file deletion.

## Acceptance

Follow `task-verify-fifty-percent-test-reduction` rules. Publish reduced real
journeys, representative boundary checks, support cleanup and local numbers.
The dependent final audit owns aggregate counting and broad/release execution,
not this cleanup task.
