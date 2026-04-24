---
id: task-seed-improver-agent-call-replay-fixture-using-reco
title: Seed improver agent-call replay fixture using recorder auto-extraction
status: ready
priority: p1
area: modules
summary: Apply the builder-agent-call-replay pattern to improver: one replay fixture covering both the improve agent step and the semantic-gate-review judge, authored entirely through pnpm kota eval record-agent-step with no hand-authored recordings.
created_at: 2026-04-24T21:49:36.813Z
updated_at: 2026-04-24T21:49:36.813Z
---

## Problem

The recorded-agent-step replay surface now covers both workflow-step
mutations (via commit-diff auto-extraction, commit `24041da3`) and
judge-call verdicts (via `--judge <label>` auto-extraction, commit
`793fbb3c`). `decomposer-agent-call-replay` and
`builder-agent-call-replay` pin those two workflows' full post-agent
shape — step + judge — without paying for a real LLM run.

Improver is the third load-bearing autonomy workflow and remains
unpinned. The retirement reason recorded in
`src/modules/eval-harness/fixtures/uncovered/notes.md` ("requires an
explicit 'clone from KOTA source' harness capability to stay honest
about fixture isolation") is stale relative to how the builder fixture
actually works today: `builder-agent-call-replay/initial/package.json`
stubs `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
`pnpm run lint:fix` to `"true"` idempotent no-ops (and aliases
`validate-tasks` to `node "$KOTA_DIST_DIR/validate-queue.js"`). The
fixture regression-gates the workflow-layer substrate — trigger
payload round-trips, inspect/gather/gate plumbing, agent-step mutation
attribution, repair-loop shape, judge routing, commit staging, restart
request — and leaves real-source build/typecheck/lint/test enforcement
to KOTA's own CI. The exact same stubbing works for improver's repair
loop; no KOTA-source clone capability is needed to land the fixture.

Leaving improver unpinned means every workflow-layer plumbing fix
touching the improve path (evidence gate, gather-run-data aggregation,
semantic-gate judge routing, mutating-step serialization scope) stays
covered only by real improver runs that each pay a live-LLM bill.
Builder's fixture has already paid off twice at replay-layer cost
(commit-stageable repair check, writeScope serialization); improver
should have the same safety net before the next improver-layer
regression costs a real run.

## Desired Outcome

`src/modules/eval-harness/fixtures/improver-agent-call-replay/` ships
as a real-failure fixture derived from a single committed improver run.
Its two recordings are produced entirely by `pnpm kota eval
record-agent-step`:

- `recordings/improve.json` via `--step improve` (the workflow agent
  step). The recorder's commit-diff mode reconstructs every
  `fileOperations` entry for repo-tree paths the agent mutated from
  the source run's commit, and `{{runDir}}` templating covers the
  run-directory artifacts (`commit-message.txt` and the evidence-gate
  fingerprint file if the step wrote one outside the commit).
- `recordings/semantic-gate-review.json` via `--judge
  semantic-gate-review`. Improver's semantic gate writes its verdict
  to `<runDir>/semantic-gate-review.json` (see
  `src/modules/autonomy/improver-semantic-gate.ts` `ARTIFACT_NAME`),
  which is the exact shape the judge-recording mode consumes.

`pnpm kota eval run --fixture improver-agent-call-replay` passes
deterministically with zero live-LLM calls, captured as a per-run
artifact under `.kota/runs/<run-id>/`.

## Constraints

- Pick a recent committed improver run (e.g. `.kota/runs/
  2026-04-24T17-23-37-109Z-improver-tqqgmc/` has a `commit.json` step
  success, a `semantic-gate-review.json` judge artifact, and the
  standard `commit-message.txt`). Honest provenance: the fixture's
  `provenance.kind` is `real-failure` with the source run id pinned.
- Reuse the builder fixture's scaffold pattern exactly:
  `initial/package.json` with `"true"` no-op scripts for
  build/typecheck/lint/lint:fix/test, `validate-tasks` aliased to
  `node "$KOTA_DIST_DIR/validate-queue.js"`, and a stub `dist/cli.js`
  whose `workflow validate` path succeeds. Do not invent a parallel
  scaffold.
- Seed a minimal `.kota/runs/` sample in `initial/` large enough for
  `aggregateRunOutcomes` to produce a realistic aggregate that
  exercises the evidence gate. Do not copy real operator runs wholesale
  — synthesize the minimum metadata shapes the gate inspects. Match
  the `initial/` file-count ceiling the other replay fixtures observe
  (~5–20 files).
- Improver's write scope is unrestricted (`writeScope: []` in
  `workflow.ts`), so the fixture's `initial/` must include the
  pre-edit state of every repo-tree path the agent mutated so the
  replay writes reproduce the post-agent shape exactly (same pattern
  as `builder-agent-call-replay`). This is fine with the recorder's
  `git show <commit>^:<path>` extraction — no KOTA-source clone is
  needed.
- Author both recordings with the existing CLI; do not hand-edit
  either recording file. If the recorder cannot produce one end-to-
  end, fix the recorder in the same commit rather than working around
  it with hand transcription.
- Predicates verify the full post-replay shape: (a) the agent's file
  mutations landed in the fixture working dir, (b) the evidence-gate
  fingerprint was written, (c) the commit step committed, (d)
  `metadata.json` shows `improve`, `commit`, and `record-evidence-
  fingerprint` at `status: success`. Mirror builder's predicate style
  (`file-exists`, `file-contains` on `.kota/runs/<fixture-run-id>/
  metadata.json`).
- Retire the improver entry in `fixtures/uncovered/notes.md` in the
  same commit. Its stated retirement reason should name the builder-
  style stub approach and the two recordings authored via the
  existing CLI; do not add new uncovered entries to compensate.
- Update `src/modules/eval-harness/AGENTS.md` "Recorded Agent-Step
  Replay" section only if the improver fixture surfaces a genuine
  gap in the existing description (e.g. a new judge label routing
  convention). If the builder description covers it, leave the doc
  alone.
- No cost signals leak into agent-facing context. Judge recordings
  keep the `0`/`0`/`0` usage placeholders used today.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Done When

- `src/modules/eval-harness/fixtures/improver-agent-call-replay/`
  ships with `fixture.json` (real-failure provenance with pinned
  source run id), `notes.md` (shape + why + recorder extraction,
  matching the builder fixture's structure), an `initial/` tree of
  ~5–20 files, and a `recordings/` directory containing exactly two
  files: `improve.json` and `semantic-gate-review.json`.
- Both recordings are regenerated end-to-end by running
  `pnpm kota eval record-agent-step --run-id <source-run-id>
  --fixture improver-agent-call-replay --step improve` and
  `pnpm kota eval record-agent-step --run-id <source-run-id>
  --fixture improver-agent-call-replay --judge semantic-gate-review`
  with no hand edits afterward.
- `pnpm kota eval run --fixture improver-agent-call-replay` passes
  deterministically with zero live-LLM calls; the run artifact is
  captured under `.kota/runs/<run-id>/`.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` removes the
  improver entry and explains the retirement in one short paragraph
  pointing at the new fixture.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Source / Intent

Direct follow-on to the just-landed judge-auto-extraction (`793fbb3c`,
`task-auto-extract-judge-call-recordings-in-the-eval-har`). That task
closed the last hand-transcription path in replay fixture authoring
and explicitly called out improver's semantic-gate judge as the next
natural consumer of the same auto-extraction mechanism. The improver
entry in `fixtures/uncovered/notes.md` also predates the builder
fixture's demonstration that stub `package.json` scripts make real-
source-tree bootstrap unnecessary for workflow-layer coverage; leaving
it stale means the next improver-layer plumbing regression pays a real
LLM bill for evidence the harness is designed to surface cheaply.

## Initiative

Eval-harness as a real autonomy regression gate: pin the three load-
bearing autonomy workflows (decomposer, builder, improver) through
replay-backed fixtures so workflow-layer regressions surface before
they cost a live run. Decomposer (`decomposer-agent-call-replay`) and
builder (`builder-agent-call-replay`) are done. Improver is the
remaining high-leverage gap.

## Acceptance Evidence

- Diff of new `src/modules/eval-harness/fixtures/improver-agent-call-
  replay/` directory (fixture.json, notes.md, initial/ tree,
  recordings/improve.json, recordings/semantic-gate-review.json) plus
  the removed improver entry in `fixtures/uncovered/notes.md`, in one
  commit.
- Transcript of both `pnpm kota eval record-agent-step` invocations
  (one for `--step improve`, one for `--judge semantic-gate-review`)
  captured in the run artifact, showing zero hand edits between the
  CLI output and the committed recording files.
- Transcript of `pnpm kota eval run --fixture improver-agent-call-
  replay` passing deterministically, captured under
  `.kota/runs/<run-id>/`, with zero live-LLM calls in the run log.
