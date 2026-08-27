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
workflow. `fixtures/dispatcher-emits-on-open-queue/` is the smoke
fixture that proves that plumbing end-to-end. The workflows below are
retired from the uncovered list because the new blocker is the absence
of a real failure to encode, not a harness gap.

- **dispatcher** — retired. 987 runs in `.kota/runs/`, all status=success.
  No real failure to encode today. Harness coverage is provided by the
  smoke fixture `dispatcher-emits-on-open-queue`, which exercises the
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
  recorded post-agent state (parent archive move, two open subtasks,
  run-directory `commit-message.txt` and `notes.md`), stages the
  mutations, and verifies the decomposer repair-loop checks, commit
  step, and restart request all complete cleanly. The existing
  `decomposer-short-circuits-on-non-timeout` smoke fixture still covers
  the decision-gate branch that never invokes an agent call.
- **builder (agent-call path)** — now covered by
  `builder-agent-call-replay`. The replay adapter extended to recognize
  the critic-review judge prompt alongside the workflow-step
  prompt, so one fixture replays both the `build` agent step and the
  critic judge from one source run (`2026-04-24T15-11-48-347Z-builder-
  gnt9c6`) without paying for any LLM. The fixture materializes the
  full post-agent repo state (task move from the active root to the done archive, four
  new files under `src/modules/eval-harness/fixtures/decomposer-short-
  circuits-on-non-timeout/`, one edit to `uncovered/notes.md`, and the
  run-directory `commit-message.txt` artifact), drives the current builder
  repair loop to success (including critic review via judge-prompt replay),
  and completes runtime-owned integration. The existing live-LLM builder fixtures
  stay live because each encodes a generator-quality shape replay
  cannot cover: smoke plumbing, partial-wiring "missed one Done When",
  active-run task ownership discipline, and measured
  empirical-code optimization against a deterministic objective metric.
  A replay-backed fixture gates the workflow-layer substrate, which is
  complementary, not overlapping.
- **improver (issue-disposition agent-call path)** — uncovered. The old
  source-editing improver replay was retired with the completion-wide
  aggregate workflow it encoded. The replacement runs once per materially
  revised durable issue, stays read-only, and has no implementation repair
  loop or semantic-quality-gate judge. A new replay needs a real source run
  from that issue-driven contract; deterministic transition and proposal
  behavior remains covered by focused tests meanwhile.
- **research-retry (workflow-layer path)** — now covered by
  `research-retry-agent-call-replay`. The fixture replays source run
  `2026-04-23T00-03-55-062Z-research-retry-u92f1u`, seeds a hermetic
  plain-http blocker so `inspect-candidates` selects work without
  Playwright or an auth profile, and regression-gates the replayable
  workflow substrate: capability evaluation, URL classification, marker
  fingerprinting, the `retry` agent step, repair checks, `mark-attempt`,
  commit, and smoke-gate inclusion through `replay-smoke.test.ts`.
  Live authenticated-browser source reading remains outside eval-
  harness replay coverage. That limitation belongs to
  `task-enable-autonomous-access-to-auth-walled-sources-so` and the
  blocked research tasks that need an operator-provided browser profile;
  it is not a missing replay fixture or harness-substrate gap.
