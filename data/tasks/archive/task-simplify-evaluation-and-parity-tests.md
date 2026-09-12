---
status: done
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

## Completion

Separated ordinary engine verification from solved benchmark replicas. Shipped
scenario manifests now load once through the production decoder; single/staged
runner tests own actual execution and artifact behavior. Retained scenario
verifiers own runtime citations, ranked-region budgets/ranges, scope/commit
artifacts, preview output and feedback recovery. Package-upgrade, helper
extraction, discovery and rename benchmarks remain intact without handwritten
solution programs in their ordinary engine tests.

Removed the assertion-free black-box runner invocation, preserving embedded-oracle
rejection. `runner-execution-outcomes.test.ts` now covers allowed and unauthorized
Git changes through real materialization/scoring instead of copying solved scope
and no-op projects. `git-changes-predicate.test.ts` retains the narrower scope and
host-execution protections. Parser/provenance, calibration, metric, container
preflight and cadence consumer tests remain because they distinguish actual bad
inputs and unavailable/non-gating outcomes.

Retained parity runner checks exposed runtime session metadata in candidate diffs.
The stage runner now stores default-scope session state with stage artifacts;
explicit scopes still take precedence. Existing failed assertions pass unchanged.

Frozen-recipe local candidate counts: eval tests 10,907 -> 10,668 (-239), parity
tests 5,046 -> 4,595 (-451), total -690. Authored support remains 6,085 / 330;
eval snapshot exclusions remain 7,415 and parity exclusions zero. No fixture or
scenario bytes changed. The sole production edit is 3 added / 1 removed lines;
module guidance adds nine net lines. These local counts do not assert completion
of the separate published-tree 50% reduction goal.

Proof: 68 distinct selected evaluator tests passed; all 94 parity owner tests
passed after repairing the observed artifact defect; final `pnpm check:fast`
passed. Detailed ownership, commands, initial failure evidence and per-file
counts/hashes are in builder run `2026-09-12T06-41-23-487Z-builder-63pjg4` artifacts.
No live model quality, container isolation or cross-preset parity claim is made.
