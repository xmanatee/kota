---
status: done
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


## Completion

Consolidated five consumer suites around observable handoffs and decisions.
Progress-reviewer now uses one real executor journey for bounded evidence transport
and hidden-citation normalization; stale compare-and-set rejection stays with the
SQLite owner. Dispatcher exercises prerequisite completion and exact next-task
delivery in one journey. Promoter recommendation delivery shares its owner-answer
cycle. Scope-improver keeps actual delegated writer execution instead of a second
declaration-only assertion. Builder/decomposer authority and independent rejection,
proposal identity, evidence integrity and security review protections remain.

Frozen-recipe local candidate test LOC: 19,356 → 19,118 (-238). Authored support
remains 1,630; production and exclusion deltas are zero. No new fixtures, snapshots,
or disabled cases. This does not establish the global published reduction target.

Selected checks: 176 passed across 14 suites; 10 publication-dependent cases could
not finish because the sandbox denied the process supervisor's /bin/ps probe.
The untouched promoter baseline reproduced its same six failures; the remaining
four occur in unchanged decomposer/improver suites. Passing proofs include exact
dispatch/dependency transitions, citation correction, builder contract authority,
real delegated writer denial, domain task effects and owner-level CAS rejection.
Full publication success is not claimed. The run summary and logs retain the
family rationale, per-file counts, baseline comparison and final static check.

Final `pnpm check:fast` passed, including production/test typechecks, lint, task
validation and generated client bindings. Scoped `git diff --check` passed.
