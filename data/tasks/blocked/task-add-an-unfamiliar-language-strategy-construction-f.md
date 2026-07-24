---
id: task-add-an-unfamiliar-language-strategy-construction-f
title: Add an unfamiliar-language strategy-construction fixture to the eval harness
status: blocked
priority: p2
area: modules
summary: Seed an eval-harness fixture where the builder must learn a tiny unfamiliar language by writing and debugging helper code against local examples and hidden tests, so strategy construction is artifact-graded rather than treated as ordinary JavaScript patching.
created_at: 2026-06-20T22:32:36.456Z
updated_at: 2026-06-20T22:47:40.355Z
---

## Problem

KOTA's eval-harness fixtures now cover no-op restraint, scope restraint,
black-box behavior reconstruction, empirical-code optimization, product
canaries, scientific-claim reproduction, dialogue-driven coding, skill
ablation, and persistent multi-round work. They still do not exercise a
different builder failure mode: adapting to an unfamiliar execution rule system
where the agent must construct and debug a strategy before it can write a
correct solution.

Most shipped coding fixtures are still in familiar JavaScript projects with
normal file/test feedback. That is useful coverage, but it can hide whether a
builder can learn a small target language or execution model from examples,
spec text, local interpreter feedback, and hidden tests. The KOTA-relevant
signal is not "support esoteric languages"; it is whether the builder can build
an executable model of unfamiliar rules, use helper or generator code
appropriately, and leave artifact evidence that the strategy worked instead of
hardcoding visible examples or relying on final prose.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a tiny
unfamiliar target language, a local interpreter or validator, example programs,
and a normalized task. The builder must produce a correct target-language
program or a checked helper/generator that emits one, then write a structured
strategy artifact such as `strategy-result.json` containing:

- the helper or generator command used, if any;
- the target-language program or generated output path;
- the local commands run to validate the solution;
- a short machine-checkable summary of discovered language rules or edge cases;
  and
- enough provenance for the scorer to verify the answer came from local
  feedback, not from hardcoded visible examples.

The fixture should make unfamiliar-rule strategy construction observable:

- The initial tree includes a deliberately incomplete solution, a compact
  interpreter or validator, visible examples, and deterministic hidden cases.
- The language is tiny and fixture-owned, but has at least one unfamiliar
  control-flow, data-layout, or output rule that rewards building a helper
  model instead of making direct familiar-language edits.
- Final predicates verify the task moved to `done/`, the target-language
  verifier passes visible and hidden cases, `strategy-result.json` is present
  and well-formed, and the implementation is not a prose-only or
  example-hardcoded answer.
- Optional objective metrics, such as hidden-case pass count or generated
  program size, are reported through the existing objective-metric path while
  pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, predicate, objective metric, and
  subprocess execution paths. Do not add a benchmark importer, a new language
  runtime dependency, an LLM judge, or a second fixture setup DSL.
- Keep the target language tiny, deterministic, and local. The fixture must run
  without network access, external services, Docker images, large dependencies,
  GPUs, or platform-specific toolchains.
- Do not import the external paper's benchmark, tasks, or solved programs.
  Build a KOTA-owned toy language that exercises the same strategy-construction
  shape.
- Allow helper or generator code when it is auditable and fixture-local. The
  scorer should reject bypasses such as changing the interpreter/verifier,
  writing a normal JavaScript implementation instead of the target-language
  artifact, delegating to a hidden oracle, or hardcoding only the visible
  examples.
- Keep this out of `pnpm test` unless replay-backed. A live-builder fixture
  belongs in `pnpm kota eval run` and cadence, not the standard unit test path.
- If the implementation environment cannot make a live nested agent call, do
  not mark the task done from fixture-load evidence alone. Reposition it
  honestly with a typed operator-capture precondition for the live pass.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-unfamiliar-language-strategy-construction/`
  exists with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the unfamiliar-language strategy-construction
  outcome and acceptance evidence.
- The initial project fails the final predicates before the builder runs, and
  `preRunExpectations` include the expected failures.
- Final predicates require the task to move to `done/`, the verifier to pass
  visible and hidden cases, `strategy-result.json` to contain the required
  strategy/provenance fields, and git changes to stay inside the allowed
  solution/helper/task paths.
- The scorer rejects obvious shortcuts, including editing the verifier,
  hardcoding visible examples, producing only a natural-language explanation,
  or bypassing the target-language artifact.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  the unfamiliar-language predicates passing and any objective metric visible
  in the run artifact and aggregate output.
- The fixture includes at least one regression check showing a shortcut
  candidate fails, then the shortcut is reverted before staging.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/unfamiliar-language-strategy-construction-live-pass
description: live eval-harness pass artifact — operator runs `pnpm kota eval run --fixture builder-unfamiliar-language-strategy-construction --repeats 1 --keep` in an environment where the nested builder harness has an active Codex login, then stores eval-run-transcript.txt, eval-set-report.json, the per-run fixture-run.json, and the produced strategy-result.json evidence under .kota/runs/unfamiliar-language-strategy-construction-live-pass/
```

## Status (2026-06-20 builder)

The fixture files, minimal initial project, Spool verifier/interpreter,
objective metric, verifier calibration, and shortcut-regression self-test have
been implemented. Local validation passed for fixture loading,
`src/modules/eval-harness/fixture.test.ts`,
`src/modules/eval-harness/eval-set.test.ts`, golden calibration, and shortcut
self-test evidence.

The required live eval was attempted from run
`.kota/runs/2026-06-20T22-35-03-761Z-builder-pscnqs/eval-run-transcript.txt`.
It reached the nested builder workflow and failed before the agent turn because
the `codex` harness reported `localAuth missing: Codex ChatGPT login not
active; run codex login`. No `strategy-result.json` was produced by a nested
builder run, so this task is blocked on the operator-captured live pass above
rather than marked done.

## Source / Intent

Explorer run `2026-06-20T22-09-37-261Z-explorer-psqhar` reviewed a zero
actionable queue (`ready=0`, `doing=0`, `backlog=0`). The strategic blocked
alternatives all still require operator-captured artifacts and were not
movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.10933` ("Frontier Coding Agents Use
  Metaprogramming to Adapt to Unfamiliar Programming Languages", submitted
  June 9, 2026) evaluates coding agents on unfamiliar esoteric programming
  languages using file editing, local execution, and hidden-test grading. The
  paper reports that stronger agents often build helper/generator programs
  rather than writing the target language directly, that forbidding the
  metaprogramming strategy sharply hurts performance, and that the broader
  failure mode is constructing and debugging a working strategy under unfamiliar
  language rules.

Local overlap check:

- `builder-black-box-behavior-reconstruction` covers discovering behavior from
  an executable oracle, not learning a target language's execution rules or
  producing a checked generator/helper strategy.
- `builder-empirical-code-optimization` covers improving a deterministic score,
  not adapting to unfamiliar syntax or semantics.
- `builder-scientific-claim-reproduction` covers reconstructing an
  underspecified analysis workflow and evidence verdict, not target-language
  strategy construction.
- `builder-skill-injection-ablation` measures explicit guidance utility, not
  whether the builder can derive a strategy from local feedback without a
  prewritten skill.
- Harness-parity scenarios cover familiar code editing, staged upgrades,
  rendered preview, investigation answers, and revise-from-test-output; none
  require building a model of an unfamiliar execution rule system.

The nonduplicative gap is one compact eval-harness fixture that grades
unfamiliar-rule strategy construction through deterministic artifacts.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders can adapt
to unfamiliar execution rules by using tools, local feedback, and auditable
helper artifacts, without importing a benchmark suite or trusting agent prose.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, verifier, and any deterministic
  scoring scripts.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  unfamiliar-language predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `strategy-result.json`, verifier output, and any objective metric values.
- Evidence of a temporary shortcut/regression causing the fixture to fail,
  with the regression reverted before staging.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-07-23T23:11:20.617Z -->
