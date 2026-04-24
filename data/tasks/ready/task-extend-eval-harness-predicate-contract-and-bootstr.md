---
id: task-extend-eval-harness-predicate-contract-and-bootstr
title: Extend eval-harness predicate contract and bootstrap to cover emit-only and dependency-heavy autonomy workflows
status: ready
priority: p2
area: autonomy
summary: Allow real-failure fixtures for autonomy workflows whose failure mode is currently not observable from a working-directory artifact (dispatcher, attention-digest, evaluator-calibration-monitor, evaluator-calibration-notify, pr-reviewer) or whose harness bootstrap is missing (decomposer, improver, research-retry).
created_at: 2026-04-24T11:53:56.234Z
updated_at: 2026-04-24T11:53:56.234Z
---

## Problem

`src/modules/eval-harness/` can only fixture-test workflows whose failure
mode is an artifact diff in the fixture's working directory, triggered by a
payload-free `manual` event, against initial state that fits in a small
`initial/` tree. Today that limits coverage to builder, explorer, and
inbox-sorter. The uncovered autonomy workflows split into two classes that
both sit behind real harness gaps:

1. **Emit-only workflows.** `dispatcher`, `attention-digest`,
   `evaluator-calibration-monitor`, `evaluator-calibration-notify`, and
   `pr-reviewer` do not mutate tracked files. Their failure modes are
   wrong-event / missing-event / wrong-payload on the bus, or a malformed
   external side effect (e.g. a missing `gh` PR comment). The current
   predicate union (`file-exists`, `file-absent`, `file-contains`,
   `shell-*`) cannot express "this event should have fired with this
   payload" or "this external call should have been made".

2. **Dependency-heavy workflows.** `decomposer` requires a trigger payload
   pointing at a fake builder run directory, and the subprocess-executor
   does not pass `--payload`. `improver` inspects `.kota/runs/` aggregates
   and then edits KOTA source/prompts/tests, so its fixture would have to
   materialize the whole KOTA repo in the working directory to be real.
   `research-retry` depends on browser-module tools whose capability the
   harness's subprocess cannot provide.

`src/modules/eval-harness/fixtures/uncovered/notes.md` records the specific
blocker, real-run references, and failure shape per uncovered workflow as a
pointer from the fixtures layer.

## Desired Outcome

Every project-shipped autonomy workflow is eligible for a real-failure
fixture under `src/modules/eval-harness/fixtures/`, and the fixtures
`uncovered/notes.md` stub stops being needed (or shrinks to only the
workflows that deliberately stay out of the harness, with a load-bearing
reason per entry). The predicate contract expresses the observation shape
each workflow's failure actually takes — bus events, trigger payloads, and
optional external-call assertions — without paper-over predicates that
pass/fail on agent self-reports.

## Constraints

- Emit-only predicate extensions inspect bus-event recordings or external
  call logs produced during the fixture run, never the agent's self-report
  or a synthesized "it worked" file. The event log has to come from the
  workflow runtime itself, not from trusting the agent.
- New predicate kinds extend the existing discriminated union in
  `src/modules/eval-harness/predicates.ts`. Do not move verification logic
  into fixture authors or introduce per-fixture helper scripts.
- Subprocess-executor payload support follows the strict-protocol rule:
  `FixtureSpecFile.triggerPayload` is typed, optional, and forwarded to
  `kota workflow trigger --payload <json>` verbatim. The subprocess may
  not synthesize defaults.
- Improver and research-retry bootstrap changes must not weaken existing
  fixture isolation (`HOME` remapped to the fixture working dir, no
  operator-repo access). If bootstrapping a workflow requires the full
  KOTA tree, the fixture declares the unusually large initial-state
  footprint in its spec and `notes.md` rather than silently cloning the
  operator's repo at runtime.
- Respect `src/modules/eval-harness/AGENTS.md`'s infrastructure-noise rule:
  any new predicate kind that consumes shell or network I/O still lands
  behind explicit `budgetMs` and the subprocess isolation boundary.
- Do not convert the workflows' own repair-loop checks into fixture
  predicates. The fixture captures the same invariant independently at the
  harness layer.

## Done When

- `src/modules/eval-harness/predicates.ts` supports at least the
  predicate kinds needed to express the failure mode of every uncovered
  workflow listed in `fixtures/uncovered/notes.md`. New kinds come with
  unit tests in `predicates.test.ts` and are documented inline in the
  predicate union, not in a parallel docs surface.
- `FixtureSpecFile` accepts an optional typed `triggerPayload` and
  `src/modules/eval-harness/subprocess-executor.ts` forwards it via
  `kota workflow trigger --payload <json>`. The existing fixtures keep
  passing without changes.
- Each emit-only workflow in the uncovered list either has a real-failure
  fixture under `fixtures/<id>/` or is explicitly retired from the list
  with a reason in `fixtures/uncovered/notes.md`.
- Each dependency-heavy workflow in the uncovered list either has a
  real-failure fixture under `fixtures/<id>/` with its bootstrap
  documented in `notes.md`, or is explicitly retired with a reason.
- Every new fixture's `provenance.sourceRunId` resolves to a real run
  under `.kota/runs/` at the time the fixture is added, and the failure
  signal in that run is visible from the fixture's predicate when the
  fixture replays end-to-end on the default host class within its
  declared `budgetMs`.
- `pnpm kota eval list` shows the new fixtures and they load without
  `FixtureProvenanceError`.
- `src/modules/eval-harness/AGENTS.md` still documents only the shape
  contract and the provenance rule, not a per-fixture inventory or per-
  workflow feasibility checklist.
