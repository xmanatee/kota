---
id: task-add-a-cross-hierarchy-signal-flow-debugging-fixtur
title: Add a cross-hierarchy signal-flow debugging fixture to the eval harness
status: backlog
priority: p2
area: modules
task_class: Meta
summary: Seed an eval-harness fixture where the builder must trace a bug through interacting files and fix the root cause from structured failure evidence instead of patching the symptom file.
created_at: 2026-07-07T23:04:35.954Z
updated_at: 2026-07-24T14:11:42.405Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
targeted test writing, full-cycle setup, feature-slice development, resource
canaries, unfamiliar-language strategy construction, and several source-
grounded or artifact-backed workflows. They still do not directly grade a
common debugging failure mode: a builder sees a concrete failing command or
test output, changes the symptom file, and passes a shallow check while missing
the upstream root cause that flows through a small hierarchy of interacting
modules.

That gap matters for autonomy quality because real bugs often propagate across
call chains, adapters, generated state, or orchestration layers. KOTA already
has harness-parity scenarios that ask an agent to discover relevant files or
rank code regions, but those do not require a builder to trace causality from
runtime evidence to a root-cause patch and then leave a machine-checkable
debugging artifact.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a compact local
project with an observed failure in one layer and a root cause in another. The
builder must trace the failure across interacting files, fix the upstream
cause, and write a structured artifact such as `debug-trace-result.json`
containing:

- the failing command or test output used as evidence;
- the symptom file or layer where the failure first appears;
- the root-cause file or layer that was actually changed;
- the causal path connecting the two; and
- the verification command and result after the fix.

The fixture should make cross-hierarchy debugging observable:

- The initial tree includes a deliberately wrong implementation whose visible
  failure appears downstream from the real bug.
- At least one tempting symptom-level patch can satisfy a narrow assertion but
  fails the final predicates or hidden regression case.
- Final predicates require the task to move to `done/`, the verification
  command to pass, the debugging artifact to identify the root cause and
  symptom path, and the implementation to avoid verifier edits or
  symptom-only shortcuts.
- Any objective metric, such as causal-path coverage or hidden-regression pass
  count, is reported through the existing objective-metric path while pass/fail
  remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, subprocess execution,
  calibration, shortcut-regression, and objective-metric paths. Do not add a
  Phoenix-bench importer, Verilator/EDA dependency, Docker-only runner, LLM
  judge, or second fixture DSL.
- Keep the scenario tiny, deterministic, and local. It must run without network
  access, external services, GPUs, hardware toolchains, large dependencies, or
  platform-specific setup.
- The fixture should borrow the failure shape, not the hardware domain: a
  small KOTA-owned JavaScript or TypeScript project with layered modules is
  enough if the bug propagates across a hierarchy and requires coordinated
  reasoning.
- The scorer must reject obvious shortcuts, including hardcoding the expected
  output, editing the verifier, changing only the downstream symptom layer,
  deleting a regression path, or writing a plausible trace artifact without
  running the verification command.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.
- Do not mark the task done from fixture-load evidence alone. The trusted host
  Runtime Probe below must complete the live nested-agent pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-cross-hierarchy-debugging/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the cross-hierarchy debugging outcome and
  acceptance evidence.
- The initial project exposes a downstream symptom and fails the final
  predicates before the builder runs; `preRunExpectations` include the expected
  missing-fix and missing-artifact failures.
- Final predicates require the task to move to `done/`, the verification
  command to pass, `debug-trace-result.json` to contain the required symptom,
  root-cause, causal-path, command, and result fields, and the changed paths to
  stay inside the accepted implementation/task evidence files.
- The fixture includes at least one calibration or regression check showing a
  symptom-only patch fails, then the shortcut is reverted before staging.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the cross-hierarchy debugging predicates passing and any objective metric
  visible in the run artifact and aggregate output.

## Runtime Probe

command: pnpm kota eval run --fixture builder-cross-hierarchy-debugging --repeats 1 --keep
timeoutMs: 14400000

## Status (2026-07-08 builder)

The fixture files, minimal initial project, cross-layer signal-routing
verifier, objective metric, verifier calibration, symptom-only shortcut guards,
and exact-path hardcoded registry shortcut calibration case have been
implemented. Local validation passed for the expected baseline downstream
failure, shortcut self-test, golden root-cause candidate, adversarial
hardcoded-registry candidate, and `pnpm kota eval list`. A repair pass on
2026-07-08 strengthened the scorer with sibling holdout behavior checks and a
source guard against concrete full signal-path literals in
`src/channel-registry.mjs`.

The required live eval was attempted from
`.kota/runs/2026-07-07T23-10-50-487Z-builder-69060k/eval-run-builder-cross-hierarchy-debugging.txt`.
It failed before the nested builder agent step because this sandbox cannot
bind localhost ports (`listen EPERM: operation not permitted 127.0.0.1:30000`),
and builder runtime-resource preflight therefore failed on leased port ranges.
No nested builder-produced `debug-trace-result.json` was produced, so that
attempt did not satisfy the live-evidence requirement.

## Status (2026-07-24 recovery)

The daemon host can bind the leased localhost range and has an authenticated
Codex harness. The live pass is now owned by the provenance-pinned Runtime
Probe above, so the earlier builder-sandbox limitation is no longer an
operator precondition.

## Source / Intent

Explorer run `2026-07-07T22-35-45-413Z-explorer-kna8gn` created this task after
reviewing an empty dispatchable queue.

External source checked:

- `https://arxiv.org/abs/2605.15226` ("Is Agentic AI Ready for Real-World
  Hardware Engineering? A Deep Dive with Phoenix-bench", submitted May 13,
  2026) describes a hardware-engineering benchmark where agentic systems must
  combine repository navigation, hierarchy-aware localization, executable
  verification, and maintenance-style patching. The KOTA-relevant signal is
  not hardware support; it is the reported failure shape where bugs propagate
  through signal flow, file-level localization is too coarse, and a single
  round of structured testbench feedback gives more useful direction than an
  oracle file hint.

Local overlap check:

- `task-add-ranked-repository-exploration-scenario-to-harn` covers returning a
  ranked list of relevant regions before implementation, not root-cause
  debugging and patching from a downstream failure.
- `task-add-a-realistic-scale-multi-file-feature-completio` covers
  symptom-level discovery in harness parity, not an eval-harness builder
  fixture with causal-trace predicates and shortcut calibration.
- `task-add-a-feature-slice-development-fixture-to-the-eva` covers adding a
  coherent feature and preserving adjacent regressions, not tracing an existing
  failure across layers to the upstream cause.
- `task-add-a-codebase-investigation-answer-scenario-to-ha` covers cited,
  runtime-backed answers without source edits, not patching the root cause.

## Initiative

Outcome-grade autonomy evaluation.

## Product / Safety Link

Product: strengthens KOTA's evidence that builders can debug layered failures
from runtime evidence and fix the cause, not just patch the first file named by
a symptom or produce a source-only explanation.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, verifier, causal-trace artifact
  contract, and deterministic shortcut-regression scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  cross-hierarchy debugging predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `debug-trace-result.json`, downstream symptom evidence, root-cause path, and
  any objective metric values.
- Evidence of a temporary symptom-only shortcut causing the fixture to fail,
  with the shortcut reverted before staging.
