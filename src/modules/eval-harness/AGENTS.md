# Eval Harness Module

This module hosts KOTA's autonomy eval harness: the strict scoring and
regression-gate contract plus the fixture-running surface that applies it.
The CLI (`kota eval`), HTTP route (`POST /api/eval/run`), and weekly
cadence workflow all reuse one execution path, so the harness has a single
observable runtime rather than three.

## Infrastructure Noise Rule

Container resource config alone can swing benchmark scores past the gap
used to rank models. The harness treats that swing as a first-class
confounder, not statistical noise. Every `FixtureRun` MUST carry:

- **Resource profile** — host class, CPU allocation (guaranteed floor) and
  kill threshold (hard ceiling) as separate fields, and matching memory
  fields. Collapsing allocation and kill erases the signal operators need.
- **Repeat index and total** — every fixture runs k times; k=1 runs do not
  participate in regression gating.
- **Timing envelope** — explicit budget plus observed duration, so runs
  that hit their deadline are distinguishable from clean returns.

## Pass@k vs Pass^k

The harness always reports both:

- `pass@k` — fraction of fixtures where at least one of k runs passed
  (capability).
- `pass^k` — fraction of fixtures where every run passed (consistency).

Gate autonomy rollouts on `pass^k`; track capability trends on `pass@k`.
Averaging them, or reporting only one, loses the distinction.

## Regression Gate Threshold

A candidate change is gated only when ALL of the following hold:

1. `pass^k` drops beyond the noise band (default 3pp).
2. Both runs used the same `k`, and `k >= MIN_REPEAT_COUNT_FOR_GATING` (3).
3. Baseline and candidate resource profiles are comparable (same host
   class, identical allocation and kill thresholds).

A drop inside the noise band, a repeat-count mismatch, or resource-profile
drift resolves to `not-gated` with a typed `reason` — evidence that the
comparison itself isn't load-bearing, not an error signal.

Operators calibrate the band per host class empirically and record the
calibration alongside the run.

## How To Add A Fixture

A fixture lives under `src/modules/eval-harness/fixtures/<id>/`. The loader
(`fixture.ts`) is the source of truth for fixture shape: it parses
`fixture.json` into a typed `FixtureSpecFile`, requires `initial/`, and
enforces provenance. A fixture that the loader rejects is a contribution
error — fix the fixture, do not work around the loader.

### Provenance

Provenance answers "why does this fixture exist?". The loader accepts
exactly two shapes, declared as a typed `provenance` field on every
`fixture.json`:

- `{ kind: "real-failure", sourceRunId: <.kota/runs/ id> }` — the fixture
  encodes a specific past autonomy failure. Use this for every fixture the
  harness exists to regression-gate against. Fixtures assembled from
  hypothetical tasks reward cosmetic progress on capability the agent
  already has and miss the failure modes the harness exists to catch (the
  demystifying-evals anti-pattern this module was created to close).
- `{ kind: "smoke-fixture", justification: <text> }` — the fixture exists
  to fail loudly when harness plumbing itself regresses. This is the narrow
  exception to the real-failure rule; the written justification is the
  contract that keeps it honest.

Anything else — missing provenance, an unknown kind, a real-failure entry
with no source run id, a smoke entry with no justification — fails loudly
at load time as a typed `FixtureProvenanceError` that names the offending
fixture directory. There is no undocumented fallback path.

### Other fixture files

`initial/` holds the initial repo state copied into each run's isolated
working directory. Include any `data/`, `.kota/`, or repo scaffolding the
target workflow needs to pick up the task.

`notes.md` stays as the human-readable companion: it names the source run id
or smoke-fixture rationale in prose, states what failed, and explains why
this fixture captures that failure. The structured source of truth lives in
`fixture.json`; `notes.md` exists for review context.

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

## Baseline Persistence And Regression Surfacing

The cadence (only the cadence) persists the last accepted aggregate as the
next run's comparison baseline, in the KOTA state root, per-project and
per-host-class, never in the repo. First run records and skips the gate.
`not-gated` rolls the baseline forward — including reasons where the
comparison isn't load-bearing — so regressions are always measured against
the most recent accepted result. `gated` holds the baseline until the next
run clears or an operator resets it manually.

On `gated`, the cadence emits a typed regression event; a dedicated bridge
workflow forwards it through the normal attention channel. Consumers MUST
subscribe to the typed event, not filter `workflow.completed` by name. CLI
and HTTP callers still own their own comparison — auto-resolution is
cadence-only.

## Runner Lifecycle

Each fixture run materializes `initial/` into a fresh `mkdtempSync` dir
under the OS tmp dir (runs never mutate the operator's repo), invokes the
workflow through the pluggable `WorkflowExecutor` (`runner.ts`; production
= `createSubprocessExecutor` spawning `kota workflow trigger <name>` with
`HOME` and `KOTA_PROJECT_DIR` pointed at the working dir; tests inject
in-process executors), evaluates predicates, and emits `fixture-run.json`.
The eval-set layer aggregates fixtures × repeats and writes
`eval-set-report.json`.

Fixtures run sequentially by design — parallel replicas would corrupt the
resource profile recorded per run, breaking the noise-band comparison.

## How To Read A Regression

`gated` means the change should not ship as-is. Reshape, rerun on the same
host class, and compare. If the drop persists across independent runs with
stable resource profiles, the regression is real. `not-gated` with
`resource-profile-drift` or `repeat-count-below-minimum` means the numbers
don't support a gate either way — rerun with correct config first.

## Boundaries

- Scoring, fixture-run contract, runner, gate decisions, and the persisted
  cadence baseline all live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through
  `eval-harness.set.completed`; regressions through the typed regression
  event; per-run evidence as run artifacts; baseline holds one row.
- No cost signals leak into agent-facing context (autonomy rule).
- Fixture working dirs materialize under `os.tmpdir()`, never inside the
  operator's repo. Always go through `runFixture` / `runEvalSet`; do not
  mutate a fixture's `initial/` at runtime.
