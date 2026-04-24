---
id: task-seed-explorer-agent-call-replay-fixture-to-regress
title: Seed explorer agent-call replay fixture to regression-gate watchlist and queue-validation paths cheaply
status: ready
priority: p1
area: modules
summary: Apply the builder/decomposer/improver agent-call-replay pattern to explorer: one replay fixture covering the explore agent step end-to-end, authored entirely through pnpm kota eval record-agent-step, so the workflow-layer substrate (repair checks, watchlist-updates plumbing, record-exploration, commit step) is gated on every pnpm test without paying for a live LLM.
created_at: 2026-04-24T23:08:48.426Z
updated_at: 2026-04-24T23:08:48.426Z
---

## Problem

The decomposer, builder, and improver workflows now each have a
recorded-agent-step replay fixture (`decomposer-agent-call-replay`,
`builder-agent-call-replay`, `improver-agent-call-replay`) and at least
one of the three rides the default `pnpm test` pass, so workflow-layer
regressions on those three critical agent workflows surface in CI
instead of only during the weekly eval-harness cadence.

Explorer is the next obvious uncovered peer. It fires every 30 minutes
on thin/empty queues, runs an agent step (`explore`) with five repair
checks (`task-queue-valid`, `architecture-ready-coverage`,
`strategic-ready-coverage`, `no-scratch-artifacts`,
`commit-message-exists`, `commit-stageable`), a watchlist-updates
side-effect step (`apply-watchlist-updates`), a
`record-exploration` timestamp step, and a commit step. Its only
current harness coverage is `explorer-strategic-ready-trip`, a live-LLM
fixture that still pays for a real agent call on every eval-set run and
gates only the `strategic-ready-coverage` repair trip. A workflow-layer
regression in the watchlist-update plumbing, the `record-exploration`
timestamp, the `apply-watchlist-updates` JSON reader, or the explorer
commit step can ship today and only surface once the weekly cadence
run fires — the same failure mode the existing replay fixtures exist
to close on the other workflows.

The recorder auto-extraction work
(`task-auto-extract-bash-and-edit-mutations-in-the-eval-h`,
`task-auto-extract-judge-call-recordings-in-the-eval-har`) plus the
replay adapter (`src/modules/eval-harness/replay-harness.ts`,
`recorder.ts`) already support everything this fixture needs:
`pnpm kota eval record-agent-step` auto-extracts the
`data/tasks/ready/task-*.md` creation, the
`data/watchlist.yaml` mutation (if any), the run-directory
`commit-message.txt` and `watchlist-updates.json` emission, and the
explore-step response envelope from a chosen source explorer run.

## Desired Outcome

One new fixture directory
`src/modules/eval-harness/fixtures/explorer-agent-call-replay/` seeded
entirely through the recorder CLI from a real past explorer run
(e.g. `2026-04-24T22-26-19-626Z-explorer-tocx88` or a comparable
recent success), containing:

- `fixture.json` declaring the explorer workflow, triggering
  `autonomy.queue.thin` with the source-run's queue-counts payload,
  and asserting via the existing predicate contract that the explore
  step, apply-watchlist-updates step, record-exploration step, and
  commit step all succeed, at least one ready task with priority
  `p0`/`p1`/`p2` lands in `data/tasks/ready/` after the run, and the
  run's `commit-message.txt` is populated.
- `initial/` tree recording the pre-run watchlist, task queue state,
  and the explorer `data/runtime/last-exploration.json` so the
  `explorationRefreshDue` branch fires.
- `explore.json` recording authored end-to-end by the recorder — no
  hand-authored agent-call entries, per the improver-replay
  precedent set by `task-seed-improver-agent-call-replay-fixture-using-reco`.
- `notes.md` naming the source run id and stating the workflow-layer
  surfaces this fixture gates (watchlist update plumbing,
  record-exploration, commit step, repair checks) vs what the existing
  `explorer-strategic-ready-trip` live fixture still covers (real-LLM
  strategic-ready-coverage trip behavior).

The fixture is wired into the `pnpm test` smoke gate alongside the
other three replay fixtures by adding it to the replay-smoke list in
`src/modules/eval-harness/replay-smoke.test.ts` (or whichever gate
file gained the entries in `task-gate-shipped-replay-fixtures-from-pnpm-test-so-wor`
and the subsequent improver/decomposer gates).

Finally, the `uncovered/notes.md` entry (explorer is not currently in
the uncovered list but the `research-retry`, `pr-reviewer`, and
emit-only workflow entries are still retired) is updated only if the
work uncovers a new retirement reason; this task does not remove any
retirement entry.

## Constraints

- Reuse the existing recorder (`pnpm kota eval record-agent-step`)
  and replay adapter. Do not introduce a parallel recording format,
  new predicate kind, or second replay harness.
- The fixture must load cleanly under `loadAllFixtures` and pass under
  `pnpm kota eval run -- --fixture explorer-agent-call-replay`. No
  hand-authored `explore.json` entries: the recorder must produce
  every recorded field.
- Source-run selection: pick a recent successful explorer run whose
  outcome already satisfies the predicates this fixture asserts (a
  strategic-ready task landed, commit step succeeded,
  watchlist-updates happened if they happened). Do not edit the
  source run's artifacts to fit the fixture; fit the predicates to
  the source run's reality.
- The fixture must not depend on network access, real `gh`/`git
  remote` calls, or the browser module. The replay adapter already
  handles the agent-step boundary; the surrounding workflow steps
  are in-process code that run against the fixture working dir.
- The `initial/data/runtime/last-exploration.json` (or equivalent
  state file consulted by `readLastExplorationAt`) must seed a
  timestamp old enough that `explorationRefreshDue` is true at fixture
  run time; the templating pass applied for
  `improver-agent-call-replay` already handles this pattern and must
  be reused rather than hand-rolling a fresh timestamp scaffold.
- Do not silently drop the existing `explorer-strategic-ready-trip`
  live fixture — the two fixtures cover complementary surfaces and
  both stay.

## Done When

- `src/modules/eval-harness/fixtures/explorer-agent-call-replay/`
  exists with `fixture.json`, `initial/`, a recorder-authored
  `explore.json`, and `notes.md` naming the source run.
- `pnpm kota eval run -- --fixture explorer-agent-call-replay`
  passes.
- The replay fixture is included in the `pnpm test` smoke gate
  alongside the decomposer/improver replays; running `pnpm test`
  exercises at least one workflow-layer assertion from the explorer
  replay fixture.
- A documentation pass in the fixture's `notes.md` explains which
  workflow-layer paths this fixture regression-gates (repair checks,
  watchlist-update plumbing, record-exploration, commit step) and
  which real-LLM failure modes it intentionally leaves to
  `explorer-strategic-ready-trip`.

## Source / Intent

Direct extension of the recent eval-harness replay-fixture initiative:
`task-seed-builder-agent-call-replay-fixture-to-regressi`,
`task-seed-improver-agent-call-replay-fixture-using-reco`, and the
decomposer-replay fixture shipped in `6e6b65ef` established the
pattern. Explorer runs every 30 minutes, and workflow-layer
regressions in its repair checks, watchlist plumbing, or commit step
today only surface during the weekly eval-harness cadence run
(explorer-strategic-ready-trip is the only existing explorer fixture,
and it gates only the `strategic-ready-coverage` trip behavior). This
task closes the coverage gap with the cheapest tool already in the
codebase.

## Initiative

Eval-harness regression-gate coverage: every recurring autonomy
workflow whose workflow-layer substrate can regress silently (repair
checks, commit step, per-workflow bookkeeping) should have a
recorded-agent-step replay fixture gated in `pnpm test`, so a
workflow-layer regression blocks commits immediately instead of
surviving until the weekly cadence.

## Acceptance Evidence

- `pnpm kota eval run -- --fixture explorer-agent-call-replay`
  transcript showing the fixture loads, replays the recorded
  explore step, and passes every declared predicate.
- `pnpm test` transcript showing the new fixture is exercised by the
  smoke gate.
- `src/modules/eval-harness/fixtures/explorer-agent-call-replay/notes.md`
  naming the source run id, the workflow-layer surfaces gated, and
  the explicit division of labor vs `explorer-strategic-ready-trip`.

## Plan

- Pick a recent successful explorer run whose outcome satisfies the
  predicates the fixture will assert (at least one p0/p1/p2 ready
  task landed, commit step succeeded, optional watchlist-updates
  captured).
- Author the fixture through `pnpm kota eval record-agent-step`
  using that source run; let the recorder produce every recorded
  entry and `initial/` tree contents.
- Wire the fixture into the `pnpm test` smoke gate and document it
  alongside the existing replays.
