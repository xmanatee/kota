---
status: done
---

# Add ranked repository-exploration scenario to harness parity

## Problem

KOTA's harness-parity artifacts now include trajectory diagnostics,
context-retrieval diagnostics, and an answer-shaped codebase-investigation
scenario. Those surfaces show whether a full coding or investigation run
reached expected files and whether a final answer cited runtime evidence.

They still do not isolate repository exploration as the output being tested.
An agent can pass or fail a patch-shaped scenario while its exploration quality
is hidden inside the later implementation path. Conversely, a harness may be
good at finding relevant code but weak at editing, and KOTA has no compact
parity scenario that asks the harness to return a ranked, budgeted map of the
code regions that matter before any implementation work starts.

SWE-Explore makes this gap concrete by evaluating coding agents on returning a
ranked list of relevant code regions under a fixed line budget, then measuring
coverage, ranking, and context-efficiency. KOTA should not import the external
benchmark or its dataset; the useful local gap is one deterministic
harness-parity scenario that scores exploration quality as a first-class
artifact.

## Desired Outcome

Add a harness-parity scenario where the agent investigates a small local
repository issue and writes a structured exploration artifact, without changing
production source.

The scenario should be self-contained and deterministic:

- The initial tree contains a small multi-file project with an issue whose
  relevant evidence spans more than one code region.
- The prompt asks for an `exploration.json` or equivalent artifact containing
  a ranked list of task-relevant regions, with path, start/end lines, rank, and
  concise rationale for each region.
- The prompt gives a fixed line budget so dumping whole files or broad
  directory listings fails.
- The verifier scores or classifies coverage of required regions, ranking
  quality, budget adherence, path/line validity, and no-production-edit
  restraint.
- Normal harness-parity output includes the trajectory, diagnostics,
  verification result, diff, run metadata, and top-level summary for the
  scenario.

## Constraints

- Keep this inside `src/modules/harness-parity/`; do not add an eval-harness
  fixture, second benchmark runner, SWE-Explore importer, scoring database, or
  LLM judge.
- Reuse the existing scenario schema and runner patterns. Extend them only if a
  ranked-region artifact cannot be verified cleanly with the current verifier
  contract.
- Keep the local repository tiny and KOTA-owned. Do not vendor external
  benchmark tasks, repositories, traces, or line-level labels.
- Keep verification deterministic through a local script. It may inspect the
  artifact, source paths, line ranges, changed files, and command transcripts,
  but it must not call a model or external service.
- This scenario tests exploration output, not implementation. Production
  source, tests, and verifier files are not valid edit targets.
- Preserve existing context-retrieval diagnostics as advisory run evidence.
  This task should complement those diagnostics with a scenario-specific
  artifact and verifier, not replace or duplicate their trajectory analysis.
- If the durable scenario coverage contract changes, update
  `src/modules/harness-parity/AGENTS.md` at the conventions level.

## Done When

- A new scenario directory exists under
  `src/modules/harness-parity/scenarios/<id>/` with `scenario.json`, an
  `initial/` tree, and a deterministic verifier for the ranked exploration
  artifact.
- `pnpm dev harness-parity list` surfaces the scenario.
- The prompt asks for a ranked region artifact under a line budget and does not
  enumerate every relevant file or line.
- The verifier fails when the artifact is missing, exceeds the line budget,
  cites stale or invalid line ranges, misses required regions, ranks irrelevant
  regions ahead of required ones, or edits production source.
- The verifier passes for a compact artifact that identifies the required
  regions within budget and leaves source unchanged.
- Focused tests cover scenario loading, initial-tree failure, valid artifact
  pass, missing-region failure, budget-overrun failure, bad line-range failure,
  and source-edit failure.
- If the harness-parity `AGENTS.md` coverage list describes scenario families,
  it names the new repository-exploration dimension.

## Source / Intent

Explorer run `2026-06-21T01-34-51-378Z-explorer-t7m6u6` reviewed a thin queue
with one actionable ready task, but `inspect-queue.strategicReadyCoverageGap`
was true because the ready item was p3 cleanup only. The strategic blocked
alternatives were all legitimate operator-capture waits and not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.07297` ("SWE-Explore: Benchmarking How Coding
  Agents Explore Repositories", submitted June 5, 2026) isolates repository
  exploration by asking agents to return ranked relevant code regions under a
  line budget, then evaluating coverage, ranking, and context efficiency.

Local overlap check:

- `task-add-context-retrieval-effectiveness-diagnostics-to` already derives
  diagnostics from full harness-parity coding trajectories, but it does not
  create an exploration-only scenario where the ranked region list is the
  deliverable and the verifier.
- `task-add-a-codebase-investigation-answer-scenario-to-ha` verifies a cited,
  runtime-backed answer with no production edits, but it does not score ranked
  code-region localization or context efficiency.
- `task-report-per-component-eval-attribution-for-score-mo` aggregates
  component evidence for eval score movement; it does not add a parity
  scenario that exercises repository exploration directly.

The nonduplicative gap is a compact KOTA-owned harness-parity scenario that
tests whether a harness can find and prioritize the code regions that matter
before implementation success or failure obscures the exploration step.

## Initiative

Harness-parity evidence quality: KOTA should compare coding harnesses not only
by final patch and verification status, but by whether they can efficiently
localize relevant repository context through a bounded, inspectable artifact.

## Acceptance Evidence

- Focused test transcript for scenario loading and verifier behavior, for
  example `pnpm test src/modules/harness-parity/scenario.test.ts
  src/modules/harness-parity/runner.test.ts` or narrower owning files.
- `pnpm dev harness-parity list` transcript showing the new scenario.
- Sample harness-parity artifact under `.kota/runs/<run-id>/` or a committed
  test fixture showing `exploration.json`, verification details, diagnostics,
  and top-level `parity.json` summary for the new scenario.

Completed evidence from builder run
`2026-06-21T02-12-34-863Z-builder-g7wed9`:

- Focused transcript:
  `.kota/runs/2026-06-21T02-12-34-863Z-builder-g7wed9/focused-tests-transcript.txt`
  (`scenario.test.ts` and `runner.test.ts`: 50 passed).
- Scenario list transcript:
  `.kota/runs/2026-06-21T02-12-34-863Z-builder-g7wed9/harness-parity-list-transcript.txt`
  includes `rank-relevant-regions`.
- Sample parity artifact:
  `.kota/runs/2026-06-21T02-12-34-863Z-builder-g7wed9/rank-relevant-regions-sample/rank-relevant-regions/parity.json`
  with passed verification, `exploration.json`, verification details, trajectory
  diagnostics, context-retrieval diagnostics, and preserved preview artifacts.
- Additional validation passed: `pnpm run validate-tasks`,
  `pnpm run typecheck`, `pnpm run lint`, and `git diff --check`.
