---
id: task-gate-shipped-replay-fixtures-from-pnpm-test-so-wor
title: Gate shipped replay fixtures from pnpm test so workflow-layer regressions surface in CI
status: done
priority: p1
area: modules
summary: Wire at least one of the three shipped agent-call replay fixtures into the standard pnpm test pass so workflow-layer regressions block commits immediately instead of waiting for the weekly eval-harness cadence.
created_at: 2026-04-24T22:31:53.879Z
updated_at: 2026-04-24T22:49:34.491Z
---

## Problem

The recently completed initiative pinned the three load-bearing autonomy
workflows through replay-backed eval-harness fixtures
(`decomposer-agent-call-replay`, `builder-agent-call-replay`,
`improver-agent-call-replay`). Each fixture replays a real source run's
agent step end-to-end without invoking a live LLM, regression-gating the
trigger payload round-trip, the `gather-run-data` aggregation, the full
repair loop, every `mutating-step` writeScope attribution path, judge
routing, the commit step's `git add -A`, and the restart request.

The gate is half-built. Nothing in `pnpm test` actually runs any of the
three replay fixtures: a grep across `src/` shows zero non-fixture-tree
references to those fixture ids. The runner unit test
(`src/modules/eval-harness/runner.test.ts`) synthesizes a minimal
throwaway fixture, the `loadAllFixtures` test only asserts the loader's
discovery behavior, and the replay-harness test exercises the adapter on
hand-built recordings. The only path that runs a shipped replay fixture
end-to-end is `pnpm kota eval run --fixture <id>` (manual) and the
weekly `eval-harness-cadence` workflow.

That means a workflow-layer regression — a change to
`src/core/workflow/runtime.ts`, `subprocess-executor.ts`, the
`replay-harness` adapter, the `gather-run-data` step, the writeScope
serialization scope, or the predicate union — can ship through every
autonomy run's `pnpm test` repair-loop check without the replay fixtures
catching it. The next failure surfaces in a real autonomy run that pays a
live LLM bill, exactly the cost shape the fixture initiative was built to
prevent.

## Desired Outcome

`pnpm test` exercises at least one shipped replay fixture end-to-end via
the same `runFixture` + subprocess executor path the cadence workflow
uses. A workflow-layer change that breaks the replay plumbing fails
`pnpm test` immediately — including inside every autonomy run's repair
loop — instead of reaching the next weekly cadence run or the next live
autonomy attempt.

## Constraints

- Use the existing `runFixture` entry point with the standard subprocess
  executor. Do not add a parallel test-only runner or stub the executor.
  The point of the gate is to catch regressions in the same execution
  path the cadence runs.
- Replay fixtures are deterministic and free (no LLM call). Adding them
  to `pnpm test` is a clean win on cost. Do not add the live-LLM
  builder fixtures (`builder-trivial-edit`, `builder-multi-point-wiring`,
  `builder-resume-doing-task`) — those intentionally cost real money and
  belong in cadence only.
- Pick the smallest replay-fixture footprint that pins the load-bearing
  surfaces. The decomposer fixture's `initial/` is the smallest and its
  agent step exercises a task move + new ready-queue files; that alone
  covers writeScope, repair loop, judge routing (the decomposer judge
  shape), and commit. If one fixture is enough, ship one; if all three
  add observable coverage cheaply, ship all three.
- Keep the test fast. Each subprocess executor spawn takes seconds, not
  minutes, but the test should reuse the materialized tmpdir within a
  single `it` block rather than re-materializing per assertion.
- Materialize fixture state under `os.tmpdir()`, never inside the repo.
  The eval-harness boundary is unchanged.
- Do not weaken the cadence path — the cadence still owns baseline
  persistence, `pass^k` aggregation, and resource-profile capture. The
  `pnpm test` gate is a smoke check (single repeat, no baseline write),
  not a full eval run.
- No cost signals leak into agent-facing context (autonomy rule).
  Replay recordings already use placeholder usage values; the new test
  reads those values, it does not synthesize new ones.
- Update the eval-harness `AGENTS.md` to name the new gate explicitly so
  future fixture authors and readers understand which path runs in
  `pnpm test` vs cadence vs CLI.

## Done When

- A new test under `src/modules/eval-harness/` runs at least one
  shipped replay fixture (`*-agent-call-replay`) through `runFixture`
  via the subprocess executor and asserts the fixture's predicates
  pass. Whichever fixtures are gated must include one fixture with a
  judge recording so the prompt-router branch is covered.
- Removing or breaking the replay adapter, subprocess executor, repair
  loop, or any predicate the fixture asserts on causes the new test to
  fail. Verified by running the test against an intentional regression
  (e.g. comment out the replay adapter registration) and confirming
  the failure mode before reverting.
- `pnpm test` runtime increase is bounded — measured before/after, with
  the delta recorded in the run artifact.
- `src/modules/eval-harness/AGENTS.md` describes which fixtures the
  smoke gate runs (and which stay cadence-only) at the conventions
  level, no fixture inventory.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Source / Intent

The eval-harness initiative was framed as "pin the three load-bearing
autonomy workflows so workflow-layer regressions surface before they
cost a live run." With improver pinning landing in commit `680af046`,
the fixture set is complete, but the regression-surfacing leg of the
sentence is only half-implemented: the cadence runs them weekly and
the CLI runs them on demand, while every autonomy run's own
`pnpm test` repair-loop check is blind to them. Each near-miss in the
past two weeks (commit-stageable repair-check additions, mutating-step
serialization, gather-run-data path edits) was caught by hand review,
not by the very fixtures the initiative built.

## Initiative

Eval-harness as a real autonomy regression gate: replay fixtures exist
to catch workflow-layer regressions before they cost live autonomy
runs. Wiring them into the standard `pnpm test` pass closes the loop —
fixture authoring (done), recorder auto-extraction (done), three
load-bearing workflows pinned (done), gate via the standard developer
+ autonomy test path (this task).

## Acceptance Evidence

- Diff showing the new test plus the `AGENTS.md` update; the test
  invokes `runFixture` against at least one shipped
  `*-agent-call-replay` fixture and asserts predicate pass.
- Transcript of `pnpm test` before/after this change captured under
  `.kota/runs/<run-id>/` showing both the gated fixture in the test
  output and the runtime delta.
- Transcript of an intentional regression (e.g. removing the replay
  adapter registration in `src/modules/eval-harness/index.ts`) causing
  the new test to fail, captured under `.kota/runs/<run-id>/` and
  reverted before commit.

## Plan

- Confirm whether `runFixture` from outside the cadence workflow needs
  any plumbing to find the shipped fixtures (path resolution, harness
  registry priming, `KOTA_DIST_DIR` for the stub `dist/cli.js`). The
  cadence workflow uses `loadAllFixtures(join(projectDir,
  "src/modules/eval-harness/fixtures"))` and a fresh subprocess
  executor with `kotaBinaryPath: bin/kota.mjs` — the same shape should
  work from a vitest `it` block.
- Decide one fixture vs all three. The replay path is the same for
  each; if all three run inside the test budget, gate all three. If
  budget is tight, gate decomposer (smallest `initial/`) plus
  improver (judge-routing branch) and leave builder for cadence.
- Land a single `eval-harness/replay-smoke.test.ts` (or extend an
  existing test file) that runs the gated fixtures via `runFixture`
  and asserts `passed: true` plus the per-predicate detail.
- Update `src/modules/eval-harness/AGENTS.md` to name the smoke gate
  vs cadence vs CLI distinction in the existing "Runner Lifecycle"
  or "Recorded Agent-Step Replay" section.
