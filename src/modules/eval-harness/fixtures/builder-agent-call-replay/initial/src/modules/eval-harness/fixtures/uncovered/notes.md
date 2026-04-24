# Uncovered autonomy workflows

These project-shipped autonomy workflows intentionally stay outside the
eval-harness fixture set. Each entry states the load-bearing reason for
retirement from coverage. If a retirement reason stops holding (e.g. a
real failure surfaces, or the bootstrap blocker is removed), retire the
entry from this list and land a matching fixture under
`src/modules/eval-harness/fixtures/`.

This directory is intentionally not a fixture: it has no `fixture.json`,
so `loadAllFixtures` skips it and the loader's provenance contract still
rejects any real fixture that omits `provenance.kind = "real-failure"`
or `smoke-fixture`.

## Emit-only workflows — retired: no real failure history

The predicate contract extension (`run-emits-event`, `run-omits-event`)
and the per-run `emitted-events.jsonl` log produced by the workflow
runtime have removed the harness-capability blocker for every emit-only
workflow. `fixtures/dispatcher-emits-on-ready-queue/` is the smoke
fixture that proves that plumbing end-to-end. The workflows below are
retired from the uncovered list because the new blocker is the absence
of a real failure to encode, not a harness gap.

- **dispatcher** — retired. 987 runs in `.kota/runs/`, all status=success.
  No real failure to encode today. Harness coverage is provided by the
  smoke fixture `dispatcher-emits-on-ready-queue`, which exercises the
  new predicate kinds against a real dispatcher run. Replace with a
  real-failure fixture when the first bad dispatcher run lands.
- **attention-digest** — retired. 622 runs, all status=success. The new
  predicate kinds make a future real-failure fixture cheap (seed a run
  metadata shape that should produce an attention envelope, assert the
  digest emission shape), but nothing motivates one yet.
- **evaluator-calibration-monitor** — retired. 75 runs, all status=success.
  A future real-failure fixture would seed calibration-aggregate inputs
  under `.kota/runs/` that should or should not trigger the gate and
  assert the `evaluator-calibration.regression.detected` emission. None
  of the 75 live runs disagreed with the gate decision, so there is no
  failure to encode yet.
- **evaluator-calibration-notify** — retired. 14 runs, all status=success.
  The workflow is pure event reshaping; a future fixture would trigger
  it with a seeded `evaluator-calibration.regression.detected` payload
  and assert the `workflow.attention.digest` emission shape via
  `run-emits-event`. No real misbridge has happened yet.
- **pr-reviewer** — retired. 0 runs on this branch. The failure mode is
  an external `gh` CLI call, not a repo-observable artifact or bus-event
  emission. A future fixture would need a fake `gh` binary on `PATH` and
  either an `external-call-log` predicate or a shell-log harness hook;
  neither is built yet, and there is no real failure to motivate them.

## Dependency-heavy workflows — retired: bootstrap blockers remain

The `triggerPayload` plumbing on `FixtureSpecFile` and
`subprocess-executor.ts` is now in place, so a decomposer fixture is
newly buildable in principle. Each workflow below is still retired for
a reason the predicate/payload changes do not resolve.

- **decomposer** — retired pending a bootstrap follow-up. 470 runs, all
  status=success. The representative real-failure shape in
  `2026-04-18T15-45-49-339Z-decomposer-zloyo6` is now expressible
  (seed a fake failed-builder `.kota/runs/<id>/metadata.json`, seed
  `doing/` + `ready/` task files, forward `{runDir, runId}` via
  `triggerPayload`), but the `decompose` step is an agent call that
  costs a real autonomous LLM run per fixture replay. Until the eval
  harness grows an agent-step fake (or the fixture is reshaped to
  short-circuit the agent step via the existing `shouldDecompose:
  false` path), a decomposer fixture would dominate eval-set cost. A
  dedicated follow-up task should scope the agent-step bootstrap
  separately.
- **improver** — retired. 153 success / 953 non-success runs with real
  failure shapes. The workflow reads the whole `.kota/runs/` aggregate
  and edits KOTA source, prompts, and tests. A real fixture would still
  need to materialize a realistic subset of the KOTA source tree
  (enough for `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  and `workflow validate` to succeed) plus a representative run-history
  sample. That bootstrap is an order of magnitude larger than any
  existing fixture's `initial/` tree and requires an explicit "clone
  from KOTA source" harness capability to stay honest about fixture
  isolation.
- **research-retry** — retired. 56 runs, all status=success. The
  workflow retries blocked research tasks using authenticated-browser
  and rendered-browser tools contributed by the browser module. The
  harness subprocess runs with `HOME` remapped to the fixture working
  dir and no credentials, so the retry step cannot exercise the browser
  path it exists to retry. A real-failure fixture needs a browser-
  capability fake that mirrors the blocked-source shape, or a module-
  loader stub at the fixture boundary. Neither is built yet.
