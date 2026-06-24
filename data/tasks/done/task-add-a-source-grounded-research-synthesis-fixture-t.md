---
id: task-add-a-source-grounded-research-synthesis-fixture-t
title: Add a source-grounded research synthesis fixture to the eval harness
status: done
priority: p2
area: modules
task_class: Platform
summary: Seed a replay-backed builder fixture where the agent must reconcile conflicting local research notes into a cited decision artifact, so grounded synthesis and citation discipline are artifact-graded instead of trusted from prose.
created_at: 2026-06-24T03:47:28.070Z
updated_at: 2026-06-24T04:46:00.000Z
---

## Problem

KOTA can read documents, store knowledge, answer with typed citations, and
grade several code-focused builder behaviors. It still lacks one compact
eval-harness fixture for a different professional agent task: turning a small
set of local, source-backed research notes into a decision artifact while
handling contradiction, stale evidence, and citation discipline.

Today a builder could write plausible prose after skimming local notes and
still pass most coding-shaped fixtures. That leaves a gap for roadmap and
research work where the success condition is not a patch or a runtime behavior
but an evidence-grounded decision: cite the right sources, reject stale or
conflicting claims, name uncertainty honestly, and produce a machine-checkable
artifact instead of an unsupported summary.

## Desired Outcome

Add one replay-backed eval-harness fixture where the builder receives a tiny
local research packet and a normalized task asking for a bounded decision.

The fixture should make grounded synthesis observable:

- The initial tree includes three to five local source documents, including at
  least one stale note, one conflict, and one source with decisive evidence.
- The task asks for a decision artifact such as
  `research-synthesis-result.json` containing the selected decision, cited
  source ids or paths, rejected-source reasons, conflict-resolution notes, and
  the verification command.
- Final predicates require the task to move to `done/`, the verification
  command to pass, the result artifact to cite only real local sources, and
  the decision to reflect the decisive evidence rather than a majority vote or
  plausible prose.
- Verifier calibration or shortcut checks reject unsupported summaries,
  invented citations, stale-source reliance, conflict omission, and edits to
  the source packet or verifier.
- Any objective metric, such as cited decisive-source count or rejected-stale
  source count, is reported through the existing objective-metric path while
  pass/fail remains predicate-based.

## Constraints

- Use the existing eval-harness fixture, replay, predicate,
  verifier-calibration, subprocess execution, and objective-metric paths. Do
  not add a notebook subsystem, benchmark importer, LLM judge, second citation
  parser, or second fixture DSL.
- Keep the source packet tiny, deterministic, and local. It must run without
  network access, external services, live model calls, large dependencies,
  Docker images, or platform-specific document tooling.
- Use plain local markdown/JSON/text sources for the first slice. This fixture
  tests source-grounded synthesis behavior, not PDF/OCR extraction quality.
- Preserve KOTA's existing answer and recall modules as product surfaces. This
  task is eval-harness coverage for builder behavior, not a new operator
  answer path.
- The replayed builder output must be produced through the normal recorded
  agent-step replay authoring path. Do not hand-write a recording that skips
  the agent-step contract.
- If the answer space is broad, add an `acceptedAlternatives` calibration case
  for a semantically equivalent valid decision. If the expected decision is
  intentionally narrow, document why golden/adversarial calibration is enough.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-source-grounded-research-synthesis/`
  exists with `fixture.json`, `notes.md`, `recordings/`, and a minimal
  `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the source-grounded research synthesis outcome and
  acceptance evidence.
- The initial project fails before the replayed builder run because the
  decision artifact is absent or incomplete, and `preRunExpectations` record
  those expected failures.
- Final predicates require the task to move to `done/`, the verifier command
  to pass, `research-synthesis-result.json` to contain required decision,
  citation, rejection, and conflict fields, and git changes to stay within the
  accepted task/artifact/helper paths.
- Verifier calibration or focused self-tests prove shortcut candidates fail:
  invented citation ids, stale-source-only decisions, conflict-free summaries,
  source packet edits, verifier edits, and prose-only artifacts.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes
  deterministically through replay with the grounded-synthesis predicates
  passing and any objective metric visible in the run artifact and aggregate
  output.

## Source / Intent

Explorer run `2026-06-24T02-56-29-091Z-explorer-jrmwnh` reviewed a thin queue
with two actionable ready tasks, both p3 source-size maintenance follow-ups,
and `inspect-queue.strategicReadyCoverageGap=true`. The surfaced strategic
blocked alternatives all still require operator-captured live evidence and
were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

Watchlist signal already recorded by recent explorer runs:

- `https://github.com/lfnovo/open-notebook` is tracked as a source-backed
  research-artifact signal for KOTA's existing read-document, knowledge,
  rendering, citation, and MCP modules. The useful local lesson is not to add
  a notebook product surface; it is to ensure builders can produce
  source-grounded research artifacts with auditable citations.
- `https://github.com/rowboatlabs/rowboat` reinforces editable knowledge and
  research-graph workflows, but KOTA should map this to existing knowledge,
  artifact, and eval primitives rather than a second memory subsystem.

Local overlap check:

- The cited-answer seam validates model-output citation markers for operator
  answers, but it is a product module path, not an eval-harness fixture for a
  builder synthesizing a local research packet into a task artifact.
- `codebase-investigation-answer` in harness-parity verifies cited
  runtime-backed answers inside a small code project, but it compares harness
  behavior and is not regression-gated as an eval-harness builder fixture.
- Existing eval-harness fixtures cover dialogue, scientific claim
  reproduction, spec-conditioned protocol work, unfamiliar-rule strategy,
  resource canaries, and answer restraint, but none isolate conflicting
  non-code research notes and citation discipline as the primary output.
- The read-document module covers extraction mechanics; this task deliberately
  starts with plain local sources so extraction quality does not obscure
  synthesis quality.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test whether builders can turn
local research evidence into an auditable decision artifact without inventing
sources, flattening conflicts, or trusting final prose.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, local source packet, verifier,
  replay recording, calibration, and `research-synthesis-result.json`
  contract.
- Focused verifier or calibration transcript showing missing artifact,
  invented citation, stale-source-only, conflict-omission, source-edit, and
  verifier-edit shortcuts fail.
- Transcript captured under `.kota/runs/<run-id>/` for `pnpm kota eval list`
  showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  grounded-synthesis predicates passing through replay.
- Run artifact from the same eval execution showing predicate details, cited
  source ids or paths, rejected-source reasons, conflict-resolution evidence,
  and any objective metric values.

Completed evidence:

- `src/modules/eval-harness/fixtures/builder-source-grounded-research-synthesis/`
  contains the fixture metadata, notes, initial project, source packet,
  verifier, calibration files, and replay recordings.
- `.kota/runs/2026-06-24T03-44-31-181Z-builder-8zj16u/eval-list-transcript.txt`
  shows `pnpm kota eval list` loads the fixture.
- `.kota/runs/2026-06-24T03-44-31-181Z-builder-8zj16u/eval-run-transcript.txt`
  shows `pnpm kota eval run --fixture builder-source-grounded-research-synthesis --repeats 1`
  passes through replay.
- `.kota/eval-runs/2026-06-24T04-47-29-309Z/builder-source-grounded-research-synthesis-0/fixture-run.json`
  records passing predicate details, cited/rejected source ids, conflict
  summary, and `source_discipline_score: 1`.
- `.kota/eval-runs/2026-06-24T04-47-29-309Z/builder-source-grounded-research-synthesis-0/verifier-calibration.json`
  records null/golden/adversarial calibration and shortcut self-test output.
- `src/modules/eval-harness/fixtures/builder-source-grounded-research-synthesis/recordings/provenance.md`
  records completed source run
  `2026-06-24T04-39-44-641Z-builder-gfdmek`, source commit `005ecdaae924`,
  and the normal `record-agent-step` extraction commands, while keeping the
  fixture honestly smoke-classified because there is no prior real-failure
  source run for this measurement gap.
