# Eval Harness Module

This module hosts KOTA's autonomy eval harness: the strict scoring and
regression-gate contract plus the fixture-running surface that applies it.
The CLI (`kota eval`), HTTP route (`POST /api/eval/run`), and weekly
cadence workflow all reuse one execution path, so the harness has a single
observable runtime rather than three.

## Infrastructure Noise Rule

Container resource configuration alone can swing benchmark scores by more
than the gap used to rank competing models (Anthropic, "Quantifying
infrastructure noise in agentic coding evals", Mar 2026). The harness
treats that swing as a first-class confounder, not as statistical noise.

Every `FixtureRun` MUST carry:

- **Resource profile** — host class, CPU allocation (guaranteed floor) and
  kill threshold (hard ceiling) as separate fields, and matching memory
  fields. Collapsing allocation and kill threshold into a single "cap"
  erases the signal operators need to interpret a drop.
- **Repeat index and total** — every fixture runs k times per evaluation.
  k=1 runs do not participate in regression gating.
- **Timing envelope** — explicit budget plus observed duration, so a run
  that hit its deadline is distinguishable from one that returned cleanly.

## Pass@k vs Pass^k

The harness always reports both:

- `pass@k` — fraction of fixtures where at least one of the k runs passed
  (capability: can the agent ever solve this?).
- `pass^k` — fraction of fixtures where every run passed (consistency: does
  the agent solve this reliably?).

`pass@k` answers "is the capability there?" and `pass^k` answers "can we
ship this?". Averaging them, or reporting only one, loses the distinction.
Gate autonomy rollouts on `pass^k`; track capability trends on `pass@k`.

## Regression Gate Threshold

A candidate autonomy change is gated only when ALL of the following hold:

1. `pass^k` drops from baseline to candidate by more than the noise band
   (default `DEFAULT_NOISE_BAND_PP = 3` percentage points).
2. Both runs used the same `k`, and `k >= MIN_REPEAT_COUNT_FOR_GATING` (3).
3. The baseline and candidate resource profiles are comparable (same host
   class, identical allocation and kill thresholds).

A drop inside the noise band, a repeat-count mismatch, or any resource
profile drift resolves to `not-gated` with a typed `reason`. The reason is
not an error signal — it is evidence that the comparison itself is not
load-bearing.

Operators calibrating the band per host class should raise
`noiseBandPercentagePoints` empirically based on observed variance on a
quiescent host, and record the calibration alongside the run.

## How To Add A Fixture

Fixtures live under `src/modules/eval-harness/fixtures/<id>/`:

- `fixture.json` — typed `FixtureSpecFile` (see `fixture.ts`): stable `id`
  matching the directory name, human `description`, autonomy `role`,
  `workflowName` to invoke, `budgetMs`, and a non-empty `predicates` array.
- `initial/` — the initial repo state copied into each run's isolated
  working directory. Include any `data/`, `.kota/`, or repo scaffolding the
  target workflow needs to pick up the task.
- `notes.md` — required. Names the source run id (or explains why none
  applies), states what failed, and explains why this fixture captures
  that failure. See existing fixtures for the expected shape.

New fixtures MUST be sourced from a real `.kota/runs/` failure. This is a
requirement, not a preference: fixtures assembled from hypothetical tasks
reward cosmetic progress on capability the agent already has and miss the
failure modes the harness exists to gate against (the demystifying-evals
anti-pattern the harness module was created to close). The narrow
exception is a smoke fixture whose explicit purpose is to fail loudly
when harness plumbing itself regresses; that fixture's `notes.md` must
state "no source run id" and justify why no failure mode is being
encoded. A fixture without either a source run id or a written
justification is a contribution error — hypothetical fixtures silently
passing a green regression gate is the failure this discipline prevents.

Predicates are intentionally small and deterministic (`predicates.ts`):
`file-exists`, `file-absent`, `file-contains`, `shell-succeeds`,
`shell-fails`. Predicates inspect the final fixture working directory;
the agent's self-report is never part of the pass/fail signal. If a new
predicate kind is needed, extend `FixturePredicate` and the evaluator —
do not push verification logic into fixture authors.

## How To Run

The harness has one code path (`runEvalSet` → `runFixture`) and three
entry points that reuse it:

- **CLI**: `pnpm kota eval list` discovers fixtures; `pnpm kota eval run`
  executes them with options for `--fixture <id>` (repeatable),
  `--repeats`, and explicit resource-profile flags. Exits non-zero when
  `pass^k < 1` so CI can gate on it.
- **HTTP**: `POST /api/eval/run` accepts a typed JSON body with the same
  fields and returns the aggregate scores plus the run-artifact base dir.
- **Cadence workflow**: `eval-harness-cadence` runs weekly (`0 7 * * 0`)
  under `autonomous` mode and writes `ran-at.json` to its run dir.

All three emit `eval-harness.set.completed` on the event bus. There is no
parallel metrics store.

## Runner Lifecycle

Each fixture run:

1. Materializes the fixture's `initial/` into a fresh `mkdtempSync`
   directory under the OS tmp dir, so runs never mutate the operator's
   repo.
2. Invokes the workflow through the pluggable `WorkflowExecutor`
   (`runner.ts`). Production uses `createSubprocessExecutor`, which spawns
   `kota workflow trigger <name>` with `HOME` and `KOTA_PROJECT_DIR`
   pointed at the fixture working dir, then polls the fixture's
   `.kota/runs/` for a terminal status matching the workflow name. Unit
   tests inject in-process executors so tests never spend LLM time.
3. Evaluates the fixture's predicates against the working directory and
   emits a `fixture-run.json` artifact beside the working dir.
4. The eval-set layer aggregates fixtures × repeats, writes
   `eval-set-report.json`, and returns the typed report.

Fixtures run sequentially by design — parallel replicas would corrupt the
resource profile recorded per run, breaking the noise-band comparison.

## How To Read A Regression

A `gated` decision means the change should not ship as-is. Reshape the
change, re-run on the same host class, and compare. If the drop persists
across independent runs with stable resource profiles, the regression is
real. If a `not-gated` decision shows `resource-profile-drift` or
`repeat-count-below-minimum`, rerun with the proper configuration before
drawing conclusions — the current numbers simply do not support a gate
either way.

## Boundaries

- Scoring, fixture-run contract, fixture runner, and gate decisions all
  live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through
  the `eval-harness.set.completed` event on the shared bus; per-run
  evidence lives as run artifacts.
- No cost signals leak into agent-facing context (existing autonomy rule).
- The subprocess executor reuses the existing `kota workflow trigger`
  surface — the module does not fork a parallel runtime for evaluation.
- Fixture working directories are materialized under `os.tmpdir()`, never
  inside the operator's repo. Always go through `runFixture` /
  `runEvalSet`; do not mutate a fixture's `initial/` at runtime.
