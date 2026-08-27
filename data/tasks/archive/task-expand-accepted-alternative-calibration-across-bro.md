---
status: done
---

# Expand accepted-alternative calibration across broad eval fixtures

## Problem

KOTA's eval harness now supports accepted-alternative verifier calibration, but
the shipped fixture set only uses it in
`builder-black-box-behavior-reconstruction`. That proves the mechanism works;
it does not prove the broad-answer-space fixtures are protected against
over-specific positive scoring.

Several high-value fixtures still have null/golden/adversarial calibration only
even though a valid candidate can naturally vary in implementation or artifact
shape:

- `builder-scientific-claim-reproduction` can compute the same refutation
  evidence through a different but valid analysis path.
- `builder-unfamiliar-language-strategy-construction` can use a different
  auditable helper/generator strategy while still producing a correct Spool
  program and strategy artifact.
- `builder-dialogue-driven-coding` can encode the clarified requirement in a
  different implementation shape while preserving the simulator transcript and
  visible outcome.
- `builder-multi-service-integration` and
  `builder-empirical-code-optimization` have similar broad-answer risk around
  equivalent wiring or optimization implementations.

If those scorers accidentally reject a valid alternative, cadence results can
look like model or harness failure when the real issue is a fixture false
negative.

## Desired Outcome

The broad-answer-space eval fixtures use accepted-alternative calibration where
it is load-bearing. The fixture set should make scorer false negatives visible
before workflow execution, without weakening shortcut rejection.

At minimum:

- Audit shipped fixtures with nontrivial `verifierCalibration` and identify
  which ones have broad valid-answer spaces versus intentionally narrow scorer
  contracts.
- Add deterministic accepted-alternative cases to the high-risk fixtures from
  that audit. Include `builder-scientific-claim-reproduction` and
  `builder-unfamiliar-language-strategy-construction` unless the builder finds
  a concrete reason their current scorer contract should remain single-positive.
- Include at least one replay-backed fixture so the changed calibration path is
  exercised in a normal fixture run without live model credentials.
- Preserve the existing null, golden, and adversarial cases for every changed
  fixture.
- Surface failed accepted alternatives through the existing
  `verifier-calibration.json`, fixture diagnostics, and eval-set
  configuration-error paths.

## Constraints

- Stay inside `src/modules/eval-harness/` and fixture-local files unless a
  narrow existing test helper needs an update. Do not add a benchmark importer,
  second verifier DSL, LLM judge, or separate fixture catalog.
- Use the accepted-alternative mechanism already added by
  `task-add-accepted-alternative-verifier-calibration-to-e`; change schema or
  runner behavior only if the audit finds a concrete missing capability.
- Accepted alternatives must be deterministic fixture-owned setup files or
  transformations. They must not require network access, provider credentials,
  live nested agent runs, Docker images, or mutation of canonical `initial/`
  trees.
- Do not add boilerplate alternatives to narrow fixtures where a single exact
  positive is the intended scorer contract. Record the skip reason in focused
  test fixtures, code comments, or the implementation evidence rather than a
  broad docs inventory.
- Preserve shortcut rejection, objective metrics, run-configuration
  fingerprints, component attribution, baseline persistence, and pass/fail
  scoring semantics.
- Do not unblock the operator-capture tasks for live eval passes; this work is
  verifier-calibration coverage, not proof that live nested builders passed.

## Done When

- The implementation includes a bounded audit of shipped nontrivial verifier
  calibration fixtures and the chosen high-risk set for accepted alternatives.
- Accepted-alternative cases exist for the broad fixtures selected by that
  audit, including the scientific-claim and unfamiliar-language fixtures unless
  explicitly disproven by implementation evidence.
- At least one replay-backed changed fixture can be run through
  `pnpm kota eval run --fixture <fixture-id> --repeats 1` without live model
  credentials, producing a `verifier-calibration.json` artifact with null,
  golden, accepted-alternative, and adversarial results.
- Focused tests prove accepted alternatives pass, null/adversarial shortcuts
  still fail, failed alternatives remain configuration errors rather than
  capability failures, and aggregate eval-set output names the failed case.
- Existing eval-harness scoring, runner, fixture loader, eval-set, and
  attribution tests still pass.

## Source / Intent

Explorer run `2026-06-21T00-47-07-035Z-explorer-iwd4n0` reviewed a thin queue:
one actionable `p3` task, no backlog, and a strategic ready coverage gap. The
strategic blocked alternatives all still require operator-captured evidence and
were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

The scaffold command was run through the source-mode CLI:

```sh
pnpm dev task create "Expand accepted-alternative calibration across broad eval fixtures" --state ready --area modules --priority p2 --summary "Add accepted-alternative verifier calibration cases to broad-answer-space eval fixtures so scorer false negatives are caught across the fixture set, not only in the one fixture used to prove the mechanism."
```

Local inspection found that only
`src/modules/eval-harness/fixtures/builder-black-box-behavior-reconstruction/fixture.json`
currently declares `acceptedAlternatives`, while many rich fixtures have
`verifierCalibration` with only null/golden/adversarial cases.

The watchlist snapshot for `https://arxiv.org/abs/2606.17799` remains the
external signal: coding-agent benchmark scores can penalize valid alternatives
when grading is tied too tightly to a single reference. The prior completed
task `task-add-accepted-alternative-verifier-calibration-to-e` added the schema
and one shipped proof case; this task expands that protection across the
fixtures most exposed to the same false-negative risk.

## Initiative

Autonomy eval harness measurement integrity: KOTA should reject shortcuts
without accidentally rejecting valid agent-produced alternatives, so cadence
regressions point to real builder or harness behavior rather than a brittle
fixture scorer.

## Acceptance Evidence

- Diff showing accepted-alternative calibration files and fixture metadata for
  the selected broad-answer-space fixtures.
- Focused test transcript for the changed eval-harness loader, runner,
  scoring, and eval-set paths, for example:
  `pnpm test src/modules/eval-harness/fixture.test.ts src/modules/eval-harness/runner.test.ts src/modules/eval-harness/eval-set.test.ts src/modules/eval-harness/scoring.test.ts`.
- Eval run transcript for at least one changed replay-backed fixture showing
  `verifier-calibration.json` contains passing accepted-alternative cases and
  failing null/adversarial cases.
- `pnpm run validate-tasks` output showing the queue remains valid.
