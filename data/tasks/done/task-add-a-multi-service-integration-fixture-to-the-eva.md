---
id: task-add-a-multi-service-integration-fixture-to-the-eva
title: Add a multi-service integration fixture to the eval harness
status: done
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must wire a small multi-component app across service boundaries, proving setup and integration failures are artifact-graded instead of hidden behind isolated code tests.
created_at: 2026-05-27T15:26:38.855Z
updated_at: 2026-05-27T15:48:46.307Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
multi-point wiring, black-box behavior reconstruction, empirical-code
optimization, bare-repository full-cycle setup, scientific-claim
reproduction, and replayed workflow substrate. They still do not exercise a
common long-horizon coding-agent failure mode: wiring a small system across
multiple runtime components where configuration, contracts, service startup,
and end-to-end verification all have to line up before business logic can be
trusted.

SaaSBench is a current primary-source signal for this gap. It argues that
existing coding-agent benchmarks often stay inside simplified single-stack
applications, while real enterprise SaaS work requires heterogeneous
multi-component integration. Its reported bottleneck is especially relevant to
KOTA: agents mostly fail before reaching deep business logic because they stop
early, misconfigure services, or get trapped in setup/debug loops.

The KOTA-relevant response is not to import SaaSBench or add a large
benchmark runner. It is to add one compact local fixture that makes
multi-service setup and integration failure visible in deterministic artifacts.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small
multi-component app with a normalized task and must make the components work
together end to end.

The fixture should be intentionally small but integration-shaped:

- At least two runtime components are present, such as a tiny HTTP API plus a
  worker, CLI, or static frontend that consumes the API.
- The seeded failure crosses a boundary rather than living in one isolated
  function: wrong route contract, mismatched environment variable, stale data
  shape, missing migration/seed step, or startup-order assumption.
- The verification path starts the needed local components, exercises the
  integrated behavior, and writes an artifact such as `integration-result.json`
  describing component startup, requests made, and observed output.
- Final predicates require the task to move to `done/`, the integration
  command to pass, and the evidence artifact to prove both components were
  exercised.
- Any objective metric, such as number of validation nodes/checks passed or
  startup retries avoided, uses the existing objective-metric path while
  pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, subprocess execution, and
  objective-metric paths. Do not add a SaaSBench importer, benchmark runner,
  Docker orchestration layer, service supervisor, or second setup DSL.
- Keep the scenario deterministic and local. It must run without external
  network, cloud services, GPUs, large dependencies, or host-specific daemons.
- Prefer built-in Node.js primitives or already-available repo dependencies
  over adding packages. If a dependency is necessary, keep it small and justify
  why a standard-library fixture cannot cover the integration boundary.
- The fixture must test integration work, not another single-process unit bug.
  A candidate that patches only one function but leaves the cross-component
  contract broken should fail.
- The scorer must reject obvious shortcuts, including hardcoded
  `integration-result.json`, skipping one component, or replacing the
  end-to-end check with a direct function call.
- Keep hidden/generated checks deterministic and inspectable in the fixture
  tree. Do not make the evaluator depend on the builder's summary or on an LLM
  judge.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-multi-service-integration/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the multi-service integration outcome and
  acceptance evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include expected failures for the broken
  cross-component behavior.
- Final predicates require the task to move to `done/`, the local integration
  command to pass, both components to have been exercised, and the evidence
  artifact to contain the expected integrated output.
- The fixture includes a shortcut-regression check showing that a candidate
  which hardcodes the artifact or bypasses one component fails, then the
  shortcut is reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the integration predicates passing and any objective metric visible in the
  run artifact and aggregate output.

## Source / Intent

Explorer run `2026-05-27T15-24-06-220Z-explorer-ykdf7n` reviewed a zero
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

- `https://arxiv.org/abs/2605.17526` introduces SaaSBench, submitted May 17,
  2026, as a benchmark for long-horizon enterprise SaaS engineering. The
  abstract highlights heterogeneous environments, full-stack orchestration,
  dependency-aware validation, and multi-component coupling as the missing
  benchmark dimensions. It reports that the dominant failure mode is not
  isolated code generation but configuring and integrating a multi-component
  system.
- `https://github.com/ShadeCloak/SaaSbench` is the project repository. Its
  current README says code, dataset, and DockerHub release are still coming
  soon, so KOTA should monitor it without waiting to import anything.

Local overlap check:

- `builder-bare-repo-full-cycle` covers environment reconstruction, test
  generation, and implementation in one small project, not coordinating
  multiple runtime components.
- `builder-frontend-preview` under harness parity covers rendered UI evidence,
  not eval-harness scoring of service startup and cross-component contracts.
- `builder-staged-package-upgrade` covers inherited maintenance edits, not
  multi-service integration.
- `builder-black-box-behavior-reconstruction`,
  `builder-empirical-code-optimization`, and
  `builder-scientific-claim-reproduction` cover other evaluation shapes.

The nonduplicative gap is a compact, artifact-graded fixture where setup and
integration across service boundaries are first-class predicates.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders can make
a small multi-component system run end to end, because real coding-agent work
often fails in configuration, contract, and orchestration layers before
isolated business logic is reached.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, integration runner/scorer, and any
  deterministic shortcut-regression assets.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  integration predicates passing.
- Run artifact from the same eval execution showing predicate details,
  component startup evidence, `integration-result.json`, and any objective
  metric values.
- Evidence of a temporary shortcut/regression causing the fixture to fail,
  with the regression reverted before staging.
