---
status: open
priority: p1
depends_on: [task-simplify-autonomy-evidence-and-decision-tests, task-simplify-workflow-step-and-trigger-tests]
---

# Keep autonomy workflow tests focused on domain decisions and handoffs

## Scope And Evidence

Own `src/modules/autonomy/workflows/**` tests and their direct consumer fixtures.
Progress-reviewer retains 3,947 LOC, including a 2,233-line workflow suite.
Review builder, dispatcher, decomposer, promoters, scope-improver and review
families without reopening their already-integrated shared owners.

## Required Outcome

Keep domain outcomes: one task selected/claimed, evidence consumed once, a useful
proposal or justified no-action, correct dependency transitions, and an actual
writer handoff. Remove repeated durable-kernel tests and copies of decision cases
covered by the predecessors. Retain thin composition where declaration/wiring
errors would otherwise escape; declaration equality is not a delivery test.

Share real setup only where consumers use the same production boundary. Do not
require every automation to inherit one giant test contract. Preserve independent
critic/decomposer rejection and changed-task authority checks. This is verification
cleanup, not permission to change scheduling or weaken task completion policies.

## Acceptance

Use `task-verify-fifty-percent-test-reduction` rules, consumer-specific checks
and representative real handoff evidence. Report removed duplicate families and
local LOC/support deltas. No per-test admission database, prompt snapshots or
full-initiative audit.
