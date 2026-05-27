---
id: task-add-a-product-requirements-canary-fixture-to-the-e
title: Add a product-requirements canary fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must preserve rich product requirements and embedded canaries across initial implementation and a follow-up modification, proving product fidelity is artifact-graded rather than inferred from polished output.
created_at: 2026-05-27T18:02:02.579Z
updated_at: 2026-05-27T18:02:02.579Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
multi-point wiring, full-cycle setup, black-box reconstruction, empirical
optimization, scientific-claim reproduction, and multi-service integration.
They still do not directly grade a different product-building failure mode:
the agent receives rich product requirements, implements a plausible-looking
surface, but loses embedded business requirements, backend behavior,
security constraints, or follow-up modification context.

SWE-WebDevBench is a current primary-source signal for this gap. It evaluates
AI app-building platforms as virtual software agencies rather than only code
generators, and highlights specification compression, frontend/backend
decoupling, weak production readiness, and regression during iterative
modification. KOTA should not import a web-app benchmark or add a separate app
builder. The local response is one compact fixture where product fidelity is
checked by executable canaries rather than by the builder's prose or a polished
interface.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small,
rich product brief plus a follow-up modification request. The builder must
implement a local app or service that preserves the brief's embedded canary
requirements and applies the modification without regressing the original
behavior.

The fixture should make product-requirement fidelity observable:

- The initial tree contains a deliberately incomplete implementation, local
  data, a product brief, and a follow-up change request.
- The brief includes several verifiable canary requirements, such as locale or
  currency formatting, role-specific authorization, audit/history behavior,
  validation rules, and at least one backend behavior that cannot be satisfied
  by a static UI or hardcoded example.
- The scorer runs deterministic checks for every canary, the follow-up
  modification, and at least one regression guard proving the original
  requirements still hold after the modification.
- The final artifact includes machine-readable evidence such as
  `requirements-result.json` with each canary id, observed result, and pass/fail
  status. Any aggregate canary score may be reported through the existing
  objective-metric path, while pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, objective-metric, and
  subprocess execution paths. Do not add a SWE-WebDevBench importer, a web-app
  benchmark runner, a second rubric engine, or an LLM judge.
- Keep the scenario small, deterministic, and local. It must run without
  network access, external services, hosted databases, Docker images, browser
  screenshots, or platform-specific host assumptions.
- Prefer a tiny HTTP service, CLI-backed service, or local full-stack stub whose
  behavior can be scored through scripts. Visual polish is not the signal; the
  canaries must inspect executable behavior and artifacts.
- The scorer must reject obvious shortcuts, including hardcoded sample-only
  responses, a static frontend that bypasses backend behavior, a prose-only
  `requirements-result.json`, or a follow-up change that passes by deleting the
  original constraints.
- Keep this out of `pnpm test` unless it is replay-backed. A live-builder
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.
- If the local environment cannot complete a live agent call, reposition the
  task honestly with a typed operator-capture precondition for the live pass;
  do not mark it done from fixture-load evidence alone.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-product-requirements-canary/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the product-requirements canary outcome and
  acceptance evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include the expected canary failures.
- Final predicates require the task to move to `done/`, the deterministic
  canary scorer to pass, `requirements-result.json` to contain every required
  canary id with observed evidence, and the follow-up modification to preserve
  the original requirements.
- The fixture includes at least one shortcut/regression check showing that a
  hardcoded sample-only or UI-only candidate fails, then the shortcut is
  reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the canary predicates passing and any canary objective metric visible in the
  run artifact and aggregate output.

## Source / Intent

Explorer run `2026-05-27T17-59-22-579Z-explorer-zonb9h` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://arxiv.org/abs/2605.04637` introduces SWE-WebDevBench, submitted
  May 6, 2026. The abstract frames the benchmark around app creation and app
  modification requests, product/engineering/ops angles, and recurring failures
  in specification fidelity, frontend/backend coupling, production readiness,
  security, and iterative modification.
- `https://github.com/snowmountainAi/webdevbench` describes SWE-WebDev-Bench
  as evaluating AI coding platforms as virtual software agencies. Its README
  names a 68-metric framework and 80 embedded canary requirements intended to
  catch template generation instead of real requirement understanding.
- `https://webdevbench.com/` is the companion benchmark site and currently
  points readers back to the GitHub project.

Local overlap check:

- `builder-multi-service-integration` covers system setup and component
  integration, not rich product canaries or iterative requirement retention.
- The completed frontend-preview harness-parity scenario covers rendered
  frontend parity, not backend fidelity or business canary preservation.
- `builder-eval-authoring-restraint` covers authoring an evaluator, not
  implementing a product brief.
- Security-review tasks cover concrete vulnerabilities, not whether a builder
  preserves security and ops requirements embedded in a product spec.

The nonduplicative local gap is a compact product-requirements fixture that
grades whether the builder carries canary requirements through implementation
and follow-up modification.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders preserve
rich product intent and modification context through executable artifacts,
without trusting polished output or importing a large benchmark.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, and deterministic canary scorer.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  canary predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `requirements-result.json`, and any canary objective metric values.
- Evidence of a temporary hardcoded/UI-only shortcut causing the fixture to
  fail, with the shortcut reverted before staging.
