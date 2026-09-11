---
status: open
priority: p1
depends_on: [task-prove-seventy-percent-test-loc-reduction]
---

# Separate evaluator-engine tests from benchmark and parity evidence

## Scope And Evidence

Own deterministic verification in `src/modules/eval-harness` (10,538 test LOC)
and `src/modules/harness-parity` (4,646). Inspect scenario loading, validation,
scoring, artifact reporting, cadence and duplicated solved-fixture programs.
`harness-parity/scenario.test.ts` alone is 1,451 LOC. Preserve useful benchmark
scenarios; the frozen count's exclusions are not a deletion opportunity.

## Required Outcome

Test parsers/scorers over representative inputs at the engine owner. Test scenario
readiness and actual evaluator behavior once, not by copying each solved project
into ordinary tests or reproducing runtime proofs already owned elsewhere.
Retain distinct anti-cheating, isolation, provenance, invalid-result and metric
semantics. Do not reduce benchmark difficulty or count source movement into
excluded fixtures as simplification.

Reuse current evaluator entry points and scenario tooling. Keep environment
selection consumer tests; remove literal configuration replicas, not validation
of actual bad inputs. Distinguish unavailable provider/container runs from pass.
The separate cross-preset parity task still owns proving live preset parity.

## Acceptance

Apply `task-verify-fifty-percent-test-reduction` rules. Report which engine tests
and scenario definitions own each changed contract, focused checks and category
deltas. No mandatory paid benchmark rerun for unchanged provider behavior, new
parity framework, or claim that fixture assertions alone prove live-agent quality.
