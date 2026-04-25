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

## Dependency-heavy workflows — retired: bootstrap blockers remain

The `triggerPayload` plumbing on `FixtureSpecFile` and
`subprocess-executor.ts` is now in place, so a decomposer fixture is
newly buildable in principle. Each workflow below is still retired for
a reason the predicate/payload changes do not resolve.

- **decomposer (agent-call path)** — now covered by
  `decomposer-agent-call-replay`. The recorded-agent-step replay surface
  (see `src/modules/eval-harness/replay-harness.ts`) lets the fixture
  exercise decomposer's `decompose` agent step end-to-end without
  paying for a real LLM run. The fixture replays source run
  `2026-04-18T15-45-49-339Z-decomposer-zloyo6`, materializes the
  recorded post-agent state (task move, two ready-queue subtasks,
  run-directory `commit-message.txt` and `notes.md`), stages the
  mutations, and verifies the decomposer repair-loop checks, commit
  step, and restart request all complete cleanly. The existing
  `decomposer-short-circuits-on-non-timeout` smoke fixture still covers
  the decision-gate branch that never invokes an agent call.
- **builder (agent-call path)** — now covered by
  `builder-agent-call-replay`. The replay adapter extended to recognize
  the phase-2 critic-review judge prompt alongside the workflow-step
  prompt, so one fixture replays both the `build` agent step and the
  critic judge from one source run (`2026-04-24T15-11-48-347Z-builder-
  gnt9c6`) without paying for any LLM. The fixture materializes the
  full post-agent repo state (task move from `ready/` to `done/`, four
  new files under `src/modules/eval-harness/fixtures/decomposer-short-
  circuits-on-non-timeout/`, one edit to `uncovered/notes.md`, and the
  three run-directory artifacts `success-criteria.txt`,
  `success-criteria-verified.txt`, `commit-message.txt`), drives the
  full builder repair loop to success (including the critic-review
  repair check via the judge-prompt replay), and completes the commit
  step plus restart request. The three existing live-LLM builder
  fixtures (`builder-trivial-edit`, `builder-multi-point-wiring`,
  `builder-resume-doing-task`) stay live because each encodes a
  generator-quality failure mode replay cannot cover (smoke plumbing,
  partial-wiring "missed one Done When", and the resume-doing-before-
  pull-ready pickup discipline); a replay-backed fixture gates the
  workflow-layer substrate, which is complementary, not overlapping.
- **improver (agent-call path)** — now covered by
  `improver-agent-call-replay`. The recorded-agent-step replay adapter
  exercises both improver's `improve` agent step and its
  `semantic-quality-gate` judge from source run
  `2026-04-24T17-23-37-109Z-improver-tqqgmc` without paying for any
  LLM. The retirement reason that previously blocked an improver
  fixture ("requires an explicit 'clone from KOTA source' harness
  capability") was stale relative to today's scaffold pattern: the
  fixture's `initial/package.json` stubs the repair-loop shell-outs as
  `"true"` no-ops (same pattern `builder-agent-call-replay` uses), its
  `.kota/runs/` seed rides the new fixture-templating pass so the
  evidence gate always sees a recent actionable run, and the two
  recordings (`improve.json` + `semantic-gate-review.json`) are
  authored end-to-end by the recorder CLI. Real `pnpm
  build`/`typecheck`/`lint`/`test` enforcement stays in KOTA's own CI.
- **research-retry** — retired. 56 runs, all status=success. The
  workflow retries blocked research tasks using authenticated-browser
  and rendered-browser tools contributed by the browser module. The
  harness subprocess runs with `HOME` remapped to the fixture working
  dir and no credentials, so the retry step cannot exercise the browser
  path it exists to retry. The agent-step replay adapter records the
  final response envelope and file mutations but does not stand in for
  live browser-tool side effects; a real-failure fixture still needs a
  browser-capability fake that mirrors the blocked-source shape, or a
  module-loader stub at the fixture boundary. Replay alone does not
  unblock research-retry.
