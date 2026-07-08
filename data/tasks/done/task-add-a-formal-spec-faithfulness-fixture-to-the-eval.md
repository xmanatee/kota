---
id: task-add-a-formal-spec-faithfulness-fixture-to-the-eval
title: Add a formal-spec faithfulness fixture to the eval harness
status: done
priority: p2
area: modules
task_class: Meta
summary: Seed an eval-harness fixture where a builder must author a small executable formal/spec contract that matches informal requirements, not just a verifier-accepted but behaviorally wrong specification.
created_at: 2026-07-08T03:21:28.463Z
updated_at: 2026-07-08T03:50:00.000Z
---

## Problem

KOTA's eval harness now has verifier calibration, accepted-alternative
calibration, source-grounded synthesis coverage, eval-authoring restraint, and
several coding-behavior fixtures. Those cover many ways a verifier can be weak,
over-specific, or prose-only. They still do not isolate a related failure mode:
an agent can write a machine-checkable specification, contract, or evaluation
oracle that is internally executable and even accepted by a proof-like path,
while the specification itself does not faithfully encode the informal user
requirement.

That matters because KOTA increasingly relies on artifact-grade evidence: task
predicates, verifier outputs, source-to-decision artifacts, and future model or
harness comparisons. If an agent can satisfy the verification layer by writing a
vacuous or underconstrained spec, KOTA may trust a "proved" result that rejects
valid behavior, accepts invalid behavior, or omits key input assumptions.

## Desired Outcome

Add one replay-backed eval-harness fixture where the builder receives a small
local programming requirement and must author a bounded executable
specification/contract that matches the informal requirement. The fixture
should make spec faithfulness observable without importing a formal-verification
toolchain:

- The initial tree contains an informal requirement, a tiny implementation or
  candidate behavior surface, official examples, adversarial counterexamples,
  and a missing or deliberately weak executable spec.
- The builder-facing task asks for the spec/contract and a machine-readable
  artifact such as `spec-faithfulness-result.json`, not for a broad benchmark
  or proof framework.
- The verifier runs the authored spec against official examples plus
  adversarial cases that expose omitted assumptions, accept-too-much behavior,
  reject-valid behavior, and single-reference overfitting.
- Final predicates inspect the executable spec, verifier output, and result
  artifact rather than trusting the builder's summary.
- Any objective metric, such as valid-case coverage or adversarial rejection
  count, is reported through the existing objective-metric path while pass/fail
  remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, replay, predicate, verifier
  calibration, accepted-alternative, subprocess execution, and objective-metric
  paths. Do not add a Verus/Rust dependency, Harbor importer, Codeforces data,
  Docker image, theorem-prover integration, LLM judge, or second fixture DSL.
- Keep the scenario tiny, deterministic, and local. Plain JavaScript or
  TypeScript fixtures are enough if the authored spec can distinguish the
  informal requirement from plausible but wrong contracts.
- Treat the external source as a failure-shape signal, not a domain import. The
  task should borrow executable spec faithfulness plus adversarial
  counterexample checking, not Verus-SpecGym's benchmark runner or corpus.
- The scorer must reject obvious shortcuts: accepting every output, matching
  only one reference output shape, omitting input assumptions, rejecting valid
  alternatives, editing the verifier or source packet, hardcoding the hidden
  case names, or writing prose without executing the spec check.
- Keep the fixture out of normal `pnpm test` unless replay-backed. Live nested
  agent execution belongs in `pnpm kota eval run` and cadence; this task should
  include replay or deterministic calibration evidence so it is not blocked on
  provider/network availability.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-formal-spec-faithfulness/`
  exists with `fixture.json`, `notes.md`, `recordings/`, and a minimal
  `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the spec-faithfulness outcome and acceptance
  evidence.
- The initial project fails before the replayed builder run because the
  executable spec or `spec-faithfulness-result.json` artifact is absent,
  vacuous, or incomplete, and `preRunExpectations` record those expected
  failures.
- Final predicates require the task to move to `done/`, the spec verification
  command to pass, the result artifact to include requirement ids, accepted
  valid cases, rejected adversarial cases, the command run, and the final
  verdict, and git changes to stay inside accepted implementation/task/evidence
  paths.
- Verifier calibration or focused self-tests prove shortcut candidates fail:
  accept-all specs, single-reference specs, omitted-assumption specs,
  reject-valid specs, hidden-case hardcoding, source-packet edits, verifier
  edits, and prose-only artifacts.
- At least one accepted-alternative calibration case proves the scorer accepts
  a meaningfully different but still faithful spec shape.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture builder-formal-spec-faithfulness --repeats 1`
  completes deterministically through replay with the spec-faithfulness
  predicates passing and any objective metric visible in the run artifact and
  aggregate output.

## Source / Intent

Explorer run `2026-07-08T02-43-09-131Z-explorer-3e6lo6` reviewed an empty
dispatchable queue. The only ready task is blocked by a pending merge claim,
the OpenRouter rollout backlog task is dependency-blocked, and every surfaced
strategic blocked alternative still requires operator-captured evidence rather
than a movable local slice:

- `task-extend-harness-parity-and-eval-harness-with-model-`
- `task-add-a-cross-hierarchy-signal-flow-debugging-fixtur`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External sources checked:

- `https://arxiv.org/abs/2605.26457` ("Verus-SpecGym: An Agentic Environment
  for Evaluating Specification Autoformalization", submitted May 26, 2026)
  studies whether agents can translate informal programming problems into
  faithful formal specifications. Its KOTA-relevant signal is that
  machine-checked code/proof can still rely on a wrong spec; the paper uses
  executable spec checks plus official and adversarial cases to catch missing
  assumptions and invalid accept/reject behavior, and reports that an
  LLM-as-judge missed a meaningful share of evaluator-caught failures.
- `https://github.com/formal-verif-is-cool/verus-spec-gym` publishes the
  accompanying Harbor-formatted benchmark assets. KOTA should not import the
  runner or corpus; the local signal is the compact failure shape.

Local overlap check:

- `task-add-eval-harness-verifier-calibration-probes` proves rich scorers
  reject null/golden/adversarial fixture states, but it does not ask a builder
  to author a faithful spec from an informal requirement.
- `task-add-accepted-alternative-verifier-calibration-to-e` reduces
  single-reference false negatives in KOTA's scorers, but it does not cover an
  agent-authored spec that is internally accepted while semantically wrong.
- `task-add-an-eval-authoring-restraint-fixture-to-the-eva` covers narrow
  executable evaluation authoring and metric sprawl, not formal/spec
  faithfulness against official plus adversarial behavior cases.
- `task-add-a-source-grounded-research-synthesis-fixture-t` and
  `task-add-a-scientific-claim-reproduction-fixture-to-the` cover source
  grounding and claim evidence, not the specific "verified wrong
  specification" risk.

The nonduplicative local gap is a compact eval-harness fixture for
specification intent fidelity: KOTA should know whether a builder can turn an
informal requirement into a bounded executable contract that is faithful under
adversarial cases, not just syntactically valid or verifier-accepted.

## Initiative

Outcome-grade autonomy evaluation.

## Product / Safety Link

Safety: prevents KOTA from trusting proof-like, verifier-backed, or
specification-backed artifacts when the authored specification fails to capture
the user's actual requirement. Product: improves confidence that builder
evidence means the requested behavior is correct, not merely that a weak
contract was satisfied.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, executable spec/verifier files,
  replay recording, calibration files, and `spec-faithfulness-result.json`
  contract.
- Focused verifier or calibration transcript showing accept-all,
  single-reference, omitted-assumption, reject-valid, hidden-case hardcoding,
  source-edit, verifier-edit, and prose-only shortcut candidates fail.
- Transcript captured under `.kota/runs/<run-id>/` for `pnpm kota eval list`
  showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture builder-formal-spec-faithfulness --repeats 1`
  showing the spec-faithfulness predicates passing through replay.
- Run artifact from the same eval execution showing predicate details,
  accepted valid cases, rejected adversarial cases, calibration results, and
  any objective metric values.

## Result

Added `builder-formal-spec-faithfulness`, a replay-backed eval-harness fixture
that asks the builder to author an executable return-label decision spec from
informal local requirements. The fixture includes official examples,
adversarial cases, a weak initial spec, verifier calibration, an accepted
alternative spec shape, replay recordings, structured result evidence, shortcut
self-tests, and an `adversarial_rejections` objective metric.

## Evidence

- `.kota/runs/2026-07-08T03-33-33-534Z-builder-enaiyt/eval-list-transcript.txt`
- `.kota/runs/2026-07-08T03-33-33-534Z-builder-enaiyt/eval-run-transcript.txt`
- `.kota/runs/2026-07-08T03-33-33-534Z-builder-enaiyt/shortcut-calibration-transcript.txt`
- `.kota/runs/2026-07-08T03-33-33-534Z-builder-enaiyt/eval-run-artifact-summary.json`
