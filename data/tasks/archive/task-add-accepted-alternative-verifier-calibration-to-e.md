---
status: done
---

# Add accepted-alternative verifier calibration to eval-harness fixtures

## Problem

KOTA's eval harness now has strict run-configuration fingerprints,
per-component score attribution, and verifier calibration cases for rich
scorers. That covers two major benchmark-integrity risks: unlike run
populations are not compared as normal model-quality signal, and weak verifiers
must prove they reject null or shortcut-shaped candidates.

The remaining scoring-integrity gap is false negatives from overspecified
positive cases. Current calibration proves a verifier accepts one golden state,
but it does not prove the verifier accepts a different valid implementation,
workflow, or artifact shape. A fixture can therefore become too close to a
single reference solution while still passing null/golden/adversarial
calibration. That is especially risky for builder fixtures whose valid answer
space is intentionally broad: service wiring, black-box behavior
reconstruction, scientific claim reproduction, unfamiliar-language strategy
construction, and future task-shaped evals should grade outcome equivalence,
not one exact implementation path.

## Desired Outcome

Eval-harness verifier calibration can include accepted-alternative positive
cases for rich scoring paths. These alternatives are fixture-owned states or
transformations that should pass the same final predicates while being
meaningfully different from the canonical golden case.

The calibration artifact should make the distinction visible:

- `null` and `adversarial` cases still prove bad candidates fail;
- the existing `golden` case still proves the canonical valid state passes;
- one or more accepted-alternative cases prove the scorer is not narrowly tied
  to one reference implementation, artifact ordering, incidental formatting, or
  hardcoded command path; and
- eval-set summaries surface fixture configuration failures when an accepted
  alternative unexpectedly fails, without counting that result as model
  capability evidence.

## Constraints

- Keep the implementation inside `src/modules/eval-harness/` plus fixture-local
  metadata and tests. Do not add a parallel benchmark runner, external paper
  importer, LLM judge, or second scoring DSL.
- Extend the existing `verifierCalibration` path instead of weakening the
  current null/golden/adversarial contract. Existing fixtures without a broad
  answer-space risk should not gain boilerplate.
- Accepted alternatives must be deterministic fixture-owned setup files or
  transformations. They must not require network access, live model calls,
  Docker images, provider credentials, or mutation of the canonical
  `initial/` tree.
- Alternatives must be meaningfully distinct from the golden case. A renamed
  copy of the same artifact is not enough; the case should exercise a valid
  alternate implementation, equivalent output ordering, alternate command
  route, or other real equivalence class the scorer should accept.
- Preserve pass/fail scoring, objective metrics, run-configuration
  fingerprints, per-component attribution, baseline persistence, pass@k/pass^k,
  and resource/profile gating.

## Done When

- The fixture schema and loader accept a typed accepted-alternative calibration
  shape for rich verifier paths, validate case ids and setup entries, and reject
  malformed cases with fixture-specific errors.
- `runFixture` evaluates accepted alternatives before workflow execution,
  records them in `verifier-calibration.json`, and treats an unexpected
  alternative failure as a fixture configuration failure excluded from
  capability scoring.
- At least one shipped rich fixture declares a genuinely distinct accepted
  alternative, and its scorer passes both the canonical golden case and the
  accepted alternative while still rejecting null and adversarial cases.
- Focused tests cover loader acceptance/rejection, successful accepted
  alternatives, a false-negative accepted alternative failure, preservation of
  null/adversarial shortcut rejection, and aggregate handling for calibration
  configuration failures.
- CLI or eval-set output surfaces the failed accepted-alternative case name in
  the same diagnostic path used for existing verifier-calibration failures.

## Source / Intent

Explorer run `2026-06-20T23-44-03-676Z-explorer-t6up10` reviewed a thin queue:
one actionable `p3` ready item, no backlog, and a strategic ready coverage gap.
The strategic blocked alternatives surfaced by `inspect-queue` all still
require operator-captured evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.17799` ("Position: Coding Benchmarks Are
  Misaligned with Agentic Software Engineering", submitted June 16, 2026)
  argues that agentic coding benchmark scores conflate model, harness,
  context, environment, and feedback signals; that single-reference grading can
  penalize equally valid alternatives; and that missing component-level signal
  makes iteration hard.

Local overlap check:

- `task-record-eval-harness-run-configuration-fingerprints` already prevents
  unlike eval populations from being compared as normal quality signal.
- `task-report-per-component-eval-attribution-for-score-mo` already turns the
  paper's component-level attribution concern into a completed KOTA report.
- `task-add-eval-harness-verifier-calibration-probes` already requires
  null/golden/adversarial calibration for rich scorers, but its positive proof
  is one canonical golden state.
- KOTA fixtures are predicate-based rather than diffed against a reference
  patch, but rich custom or shell-backed scorers can still become
  over-specific. The nonduplicative gap is to prove accepted valid alternatives
  in verifier calibration.

## Initiative

Autonomy eval harness measurement integrity: KOTA should reward valid
agent-produced outcomes through calibrated local artifacts, not accidentally
train its regression gate around one reference-shaped solution.

## Acceptance Evidence

- Focused test transcript:
  `.kota/runs/2026-06-21T00-47-06-643Z-builder-tcwbba/focused-tests.txt`
  shows 5 eval-harness test files passing with 91 tests:
  `fixture.test.ts`, `runner.test.ts`, `eval-set.test.ts`,
  `scoring.test.ts`, and `black-box-behavior-fixture.test.ts`.
- Real shipped-fixture calibration artifact:
  `.kota/runs/2026-06-21T00-47-06-643Z-builder-tcwbba/calibration-artifact/builder-black-box-behavior-reconstruction-0/verifier-calibration.json`
  contains passing `null`, `golden`, accepted alternative `reduce-loop`, and
  `adversarial` case results.
- The false-negative accepted-alternative path is covered by
  `runner.test.ts` and `eval-set.test.ts`: workflow execution is not called,
  the run outcome is `configuration-error`, and aggregate scoring surfaces the
  failed `alternate-output` case name instead of counting it as capability
  evidence.
