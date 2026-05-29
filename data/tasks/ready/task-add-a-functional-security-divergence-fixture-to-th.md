---
id: task-add-a-functional-security-divergence-fixture-to-th
title: Add a functional-security divergence fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must implement a small feature that passes functional tests and hidden security checks, proving secure behavior is artifact-graded rather than inferred from green unit tests.
created_at: 2026-05-29T01:36:05.289Z
updated_at: 2026-05-29T01:36:05.289Z
---

## Problem

KOTA now has a security-review workflow that finds and follows up on concrete
vulnerabilities in this repository, and the eval harness has fixtures for
no-op restraint, scope restraint, black-box behavior reconstruction,
empirical-code optimization, scientific-claim reproduction, product
requirements canaries, persistent rounds, and multi-service integration. It
still does not directly grade a recurring builder failure mode: the agent
implements a feature that passes the ordinary functional tests while leaving a
security property broken.

Agent Security League and SusVibes make this gap concrete. Their shared lesson
is not that KOTA should import an external vulnerability benchmark or a
leaderboard. It is that "tests pass" and "safe to ship" need separate,
artifact-graded evidence. KOTA's local eval harness should include one compact
fixture where the functional path can go green while a hidden security scorer
still fails, so the builder must preserve secure behavior rather than merely
matching happy-path examples.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small local
feature request, visible functional tests, and enough surrounding code to
implement a plausible working solution. The correct solution must also satisfy
deterministic security checks that are not reducible to the public happy-path
tests.

The fixture should make functional/security divergence observable:

- The initial project contains a deliberately incomplete feature plus public
  tests that prove normal behavior.
- A separate scorer or predicate checks at least one security canary, such as
  path traversal prevention, authorization, input validation, output escaping,
  signature verification, or secret-safe error handling.
- A naive implementation that passes the public functional tests but violates
  the security property fails the fixture.
- The final artifact includes machine-readable evidence, such as
  `security-result.json`, naming the functional result, the security canary
  ids, and the observed pass/fail status.
- Any optional objective metric, such as `security_canary_score`, uses the
  existing objective-metric path while pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, objective-metric, and
  subprocess execution paths. Do not add a SusVibes importer, Agent Security
  League runner, external vulnerability database, LLM judge, or second scoring
  system.
- Keep the scenario small, deterministic, and local. It must run without
  network access, external services, Docker images, hosted databases, or
  platform-specific host assumptions.
- The fixture should grade secure behavior, not discovery of a live KOTA
  vulnerability. The security-review workflow remains the path for reviewing
  KOTA's own code.
- The scorer must reject obvious shortcuts, including hardcoded sample-only
  outputs, bypassing the vulnerable path, disabling functional behavior to make
  the security check pass, or writing a plausible prose-only result artifact.
- Keep this out of `pnpm test` unless it is replay-backed. A live-builder
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.
- If the local environment cannot complete a live agent call, reposition the
  task honestly with a typed operator-capture precondition for the live pass;
  do not mark it done from fixture-load evidence alone.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-functional-security-divergence/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes both the functional outcome and the security
  canary evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include the expected functional and security failures.
- Final predicates require the task to move to `done/`, public functional
  behavior to pass, the security canary scorer to pass, and
  `security-result.json` to contain every required canary id with observed
  evidence.
- The fixture includes at least one shortcut/regression check showing that a
  functionally green but insecure candidate fails, then the shortcut is
  reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the functional and security predicates passing and any security objective
  metric visible in the run artifact and aggregate output.

## Source / Intent

Explorer run `2026-05-29T01-33-31-383Z-explorer-tzf3gm` reviewed a thin queue.
There was one actionable ready security task and the strategic blocked
alternatives all still required operator-captured artifacts, so opening a
focused eval-harness slice was preferable to declaring no-op or creating
surface-parity work.

External sources checked:

- `https://www.endorlabs.com/research/ai-code-security-benchmark` tracks Agent
  Security League as a live benchmark for AI coding agents, reporting both
  functional and security correctness rather than treating ordinary test pass
  rate as the whole outcome.
- `https://www.endorlabs.com/learn/agent-security-league-evaluating-the-security-of-ai-coded-software`
  summarizes the same pattern over SusVibes: functionally correct agent output
  often remains insecure, and the useful measurement split is "does it work?"
  versus "is it secure?"
- `https://arxiv.org/abs/2512.03262` introduces SusVibes, a repository-scale
  benchmark of real-world feature-request tasks where generated code is
  measured on both functional and security outcomes.

Local overlap check:

- `security-review` finds and follows up on vulnerabilities in KOTA itself;
  it does not grade a builder's ability to implement a new feature securely.
- `builder-product-requirements-canary` includes authorization and validation
  canaries inside a product brief, but its signal is broad requirement
  retention across a follow-up change, not the specific functional-pass /
  security-fail divergence.
- Existing restraint and optimization fixtures check scope, no-op behavior,
  objective metrics, and product fidelity; none require a functionally green
  but insecure candidate to fail through a security scorer.

The nonduplicative local gap is a compact security-focused builder fixture that
separates functional correctness from secure correctness through deterministic
artifacts.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders produce
secure code when ordinary functional tests are insufficient, without importing
an external benchmark or trusting agent self-report.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and deterministic security scorer.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  functional and security predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `security-result.json`, and any security objective metric values.
- Evidence of a temporary functionally green but insecure shortcut causing the
  fixture to fail, with the shortcut reverted before staging.
