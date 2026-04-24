---
id: task-seed-builder-agent-call-replay-fixture-to-regressi
title: Seed builder agent-call replay fixture to regression-gate workflow-layer paths cheaply
status: ready
priority: p1
area: modules
summary: Extend the eval-harness agent-step replay adapter to the builder workflow: record a real past builder run and ship a replay fixture that regression-gates the repair-loop, commit-stageable, and serialization paths without paying for a live LLM on every eval-set invocation.
created_at: 2026-04-24T19:32:25.408Z
updated_at: 2026-04-24T19:32:25.408Z
---

## Problem

The recorded agent-step replay adapter landed in commit `241491bd` and
ships one consumer — `fixtures/decomposer-agent-call-replay/`. Every
existing builder fixture in `src/modules/eval-harness/fixtures/`
(`builder-trivial-edit`, `builder-multi-point-wiring`,
`builder-resume-doing-task`) still declares `real-failure` provenance
but carries no `recordings/` directory, so the workflow subprocess
invokes a real `claude-agent-sdk` agent run on every eval-set
invocation. Their budgets (`1500000`–`1800000` ms) reflect live LLM
wall-clock, which means the eval-set cannot run cheaply enough to act
as a per-autonomy-change regression gate — the exact role the harness
exists to play.

Builder is the highest-volume autonomy workflow (600 `builder-*` run
directories under `.kota/runs/`), and it is where workflow-layer
regressions have repeatedly shown up at real cost (see commits
`c76400c0` catching `git add -A` ignore conflicts in the repair loop
after a 75-minute agent loss, `75b22a6c` serializing mutating agent
steps after cross-blame on `writeScope`). Those regressions are
plumbing-shape, not agent-behavior-shape — they are exactly what a
replay-backed fixture can catch cheaply. Today none of them are
mechanically guarded.

## Desired Outcome

A new builder replay fixture lives alongside
`fixtures/decomposer-agent-call-replay/` and regression-gates the
builder workflow's repair-loop, commit-stageable, and serialization
paths end-to-end through the same subprocess executor path the daemon
runs in production, without invoking a real LLM. The fixture is seeded
from a real past `.kota/runs/` builder run (author picks the specific
run while scoping the task) and pins that run id in the fixture's
`provenance.sourceRunId`. The existing live-LLM builder fixtures are
reviewed as part of this change: either kept as-is (with a written
rationale for what agent-behavior signal they still carry that replay
cannot), converted to replay, or retired in favor of the new one.

Concretely:

- `src/modules/eval-harness/fixtures/builder-agent-call-replay/` (or a
  similarly named directory) ships with `fixture.json`, `initial/`,
  `recordings/<stepId>.json` for the builder agent step, and `notes.md`
  explaining what the fixture regression-gates and why its shape was
  chosen.
- Predicates assert the post-agent repo state (task state transitions,
  commit-message artifact, staged changes, any source-file mutations
  load-bearing to the failure shape encoded) and the run artifact
  metadata (agent step, repair checks, commit step statuses) the same
  way `decomposer-agent-call-replay` does.
- `pnpm kota eval run --fixture <id>` passes deterministically without
  any network call or credential read; the captured per-run artifact
  records zero live-LLM calls.
- The recorder extraction is documented: either a single
  `pnpm kota eval record-agent-step --run-id <id> --step <step>
  --fixture <id>` invocation suffices, or the `notes.md` explicitly
  lists the manual `fileOperations` edits the author added for
  Edit/Bash mutations the recorder does not yet auto-capture.
- `fixtures/uncovered/notes.md` updates to reflect the new coverage
  state for builder's agent-call branch.

## Constraints

- The recording must come from a real past `.kota/runs/<id>/` builder
  run and pin that source id in both `fixture.json` `provenance` and
  the recording's `sourceRunId`. A hand-authored "hypothetical"
  response is not acceptable (fixture-provenance rule in
  `src/modules/eval-harness/AGENTS.md`).
- No test-only production flags, no `src/core/agent-harness/` mock
  layers. The replay adapter is already the one seam; this fixture
  uses it unchanged. Any adapter-side gap that blocks the builder
  case (e.g. file operations the recorder does not yet auto-extract,
  prompt-shape assumptions that break under the builder prompt) is
  fixed inside `src/modules/eval-harness/`, not by adding a second
  path.
- Do not replace every existing builder fixture with replay silently.
  Treat each one as a decision: a fixture that regression-gates
  agent-behavior (generator quality) is different from one that gates
  workflow plumbing. Record the decision per fixture in `notes.md`.
- Do not introduce a parallel fixture layout. Recordings live under
  `<fixtureDir>/recordings/`, not in `.kota/` and not in a sibling
  directory. The subprocess executor already forwards
  `KOTA_EVAL_HARNESS_REPLAY_ROOT`; no new env var.
- Provenance stays honest: if the chosen source run mutates KOTA
  source files, those mutations belong in the recording's
  `fileOperations` list and travel with the fixture. Fixtures must
  not depend on mutable repo state outside `initial/` + `recordings/`.
- No cost signals leak into agent-facing context. Recorded `usage` and
  `totalCostUsd` stay evaluator-visible only.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm kota workflow
  validate` all pass.

## Done When

- `src/modules/eval-harness/fixtures/builder-agent-call-replay/` (or
  the author-chosen equivalent name) exists with `fixture.json`,
  `initial/`, `recordings/`, and `notes.md`.
- `fixture.json` declares `workflowName: "builder"`, `role: "builder"`,
  a budget in the same order as the decomposer replay fixture (~120s
  or less — no live-LLM budget), `provenance.kind: "real-failure"`
  with a concrete `sourceRunId`, and predicates covering the post-agent
  repo state plus run-artifact metadata.
- `pnpm kota eval run --fixture <id>` succeeds end-to-end in one pass
  with no live-LLM call, captured as evidence under
  `.kota/runs/<run-id>/` — the agent step, repair checks, commit step,
  and any restart request all complete cleanly.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` is updated to
  reflect the new coverage; any existing live-LLM builder fixture that
  stays live has a recorded rationale; any retired fixture is deleted
  from the tree in the same commit.
- `src/modules/eval-harness/AGENTS.md` remains accurate — if the
  builder fixture exposes any pattern the existing replay section did
  not cover (e.g. how to encode a multi-file agent mutation), the
  section is extended in one short paragraph.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm kota workflow
  validate` all pass.

## Source / Intent

Follow-on to the just-landed recorded agent-step replay adapter
(commit `241491bd`, task
`task-bootstrap-deterministic-agent-step-replay-for-eval`). The
replay surface was built specifically so the eval-harness could
regression-gate workflow-layer changes without per-fixture live-LLM
cost, but only one consumer (decomposer) ships with a recording today.
Builder is the autonomy workflow where workflow-layer regressions have
repeatedly caught real runs (commits `c76400c0`, `75b22a6c`), so
extending replay coverage to builder is where the harness first earns
back a gate's worth of trust. This task preserves that intent instead
of letting the replay adapter ship with one consumer and drift into a
decomposer-only mechanism.

## Initiative

Eval-harness as a real autonomy regression gate: KOTA's autonomy
workflows should be covered by fixtures cheap enough to run per
autonomy-change, seeded from real past failures, so plumbing
regressions in the load-bearing workflows (decomposer, builder,
critic-as-judge, improver) are caught before they cost a real run.

## Acceptance Evidence

- `pnpm kota eval run --fixture <id>` transcript and artifact under
  `.kota/runs/<run-id>/` showing a clean pass with zero live-LLM calls,
  end-to-end through the builder subprocess.
- Diff of the fixture directory (fixture.json, initial/, recordings/,
  notes.md) plus any recorder-side updates if the builder case
  surfaced a gap.
- Updated `fixtures/uncovered/notes.md` entry for builder.
