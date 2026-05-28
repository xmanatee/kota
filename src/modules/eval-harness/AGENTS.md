# Eval Harness Module

This module hosts KOTA's autonomy eval harness: strict scoring, regression
gating, and fixture execution. CLI, HTTP, and cadence use one path.

## Infrastructure Noise Rule

Container resource config can swing benchmark scores past model ranking gaps,
so every fixture run must carry:

- **Resource profile** — host class, CPU allocation and kill threshold as
  separate fields, with matching memory fields.
- **Execution profile preflight** — backend kind, requested, observed or
  enforced profile, diagnostics, and gate eligibility. Host subprocess runs may
  score fixtures, but are non-gating unless an executor verifies/enforces CPU
  and memory facts.
- **Repeat index and total** — fixtures run k times; k=1 is non-gating.
- **Timing envelope** — budget plus observed duration, distinguishing deadline
  hits from clean returns.

## Pass@k vs Pass^k

The harness always reports both:

- `pass@k` — fraction of fixtures where at least one of k runs passed
  (capability).
- `pass^k` — fraction of fixtures where every run passed (consistency).

Gate rollouts on `pass^k`; track capability trends on `pass@k`. Averaging
them, or reporting only one, loses the distinction.

## Regression Gate Threshold

A candidate change is gated only when ALL of the following hold:

1. `pass^k` drops beyond the calibrated noise band.
2. Both runs used the same `k`, and `k` is at or above the gating minimum.
3. The candidate execution preflight is gate-eligible.
4. Baseline and candidate resource profiles are comparable (same host
   class, identical allocation and kill thresholds).

A drop inside the noise band, repeat-count mismatch, non-gating execution
profile, or resource drift resolves to typed non-gating evidence.

Operators calibrate the band per host class empirically and record the
calibration alongside the run. Concrete defaults live in code.

## Fixture Provenance

Provenance answers "why does this fixture exist?". The loader accepts two
shapes:

- **Real failure** — encodes a specific past autonomy failure and points at
  its source run id. Use this for every regression-gated fixture.
- **Smoke fixture** — fails loudly when harness plumbing regresses; a
  written justification keeps the exception honest.

Anything else fails loudly at load time as a typed error naming the fixture.
Fix rejected fixtures; do not work around the loader.

## Predicate Contract

Predicates are small and deterministic. They inspect the final fixture working
directory; the agent's self-report is never signal. New kinds extend the
predicate union and evaluator.

Fixtures also declare `preRunExpectations`: expected initial predicate results.
At least one must be `expected: "fail"`; mismatches are fixture config errors.

Persistent multi-round fixtures use `mode: "multi-round"` with ordered
`rounds`. Each round names its workflow, budget, task input (`initial-state`,
`copy-fixture-file`, or `trigger-payload`), pre-run expectations, and
predicates. The runner preserves one working directory, scores the fixture as
one pass@k/pass^k unit, and records round outcomes in `fixture-run.json`.
Single-workflow fixtures remain the default when `mode` is absent.

Objective metrics are deterministic numeric evidence on the same fixture path,
not a second benchmark runner. They may come from fixture files, runtime
artifacts, or local deterministic commands and are reported in run and aggregate
artifacts. Pass/fail gating stays predicate-only unless a fixture adds a
threshold predicate. Compare metric deltas only for compatible resource and
execution profiles.

## Baseline Persistence And Regression Surfacing

Only the cadence persists the last accepted aggregate as the next
comparison baseline, in the KOTA state root, per-project and
per-host-class, never in the repo. First run records and skips the gate.
`not-gated` rolls the baseline forward, including non-load-bearing comparison
reasons, so regressions compare against the latest accepted result. `gated`
holds the baseline until the next clear run or manual reset.

On `gated`, the cadence emits a typed regression event; a bridge workflow
forwards it through the attention channel. Consumers subscribe to the
typed event, not generic completion events. CLI and HTTP callers own their
own comparison; auto-resolution is cadence-only.

## Runner Lifecycle And Execution Paths

Each fixture run materializes initial state into a fresh tmpdir, invokes the
workflow through a pluggable executor, evaluates predicates, and emits a
per-run artifact. Fixtures run sequentially; parallel replicas corrupt resource
profiles and noise-band comparison. `gated` means do not ship as-is; rerun on
the same host class to confirm. `not-gated` with profile drift or too small a
sample means rerun with correct config.

Three paths share the same `runFixture` + subprocess executor:

- **Smoke gate (`pnpm test`)** — `replay-smoke.test.ts` runs one shipped
  `*-agent-call-replay` fixture at `repeats=1`, no baseline, so workflow-layer
  regressions fail the standard test pass, including autonomy repair-loop
  checks. The fixture must cover workflow-step and judge-prompt branches.
  Live-LLM fixtures stay out.
- **Cadence (`eval-harness-cadence`)** — every shipped fixture, weekly,
  `repeats=k`, owns the persisted baseline and `pass^k` aggregation.
- **CLI (`pnpm kota eval run`)** — operator-driven; caller owns the
  comparison, no baseline persistence.

## Recorded Agent-Step Replay

Agent-call fixtures ship one recording per agent call under
`<fixtureDir>/recordings/<id>.json`. The subprocess executor sets
`KOTA_EVAL_HARNESS_REPLAY_ROOT`; the module overrides the
`claude-agent-sdk` slot with a replay adapter. Replay subprocesses also
force `KOTA_PRESET=claude` so workflows resolve to the replay-overridden
harness. Container subprocesses bind-mount the recording root read-only at
the same absolute path so the env root is readable inside the container.
Production selection is unchanged.

The adapter substitutes `{{runDir}}` in recorded paths, writes operations
to the fixture working dir, and `git add -A`s them so downstream repair
checks see the same tree the real agent produced. Every recording's
`sourceRunId` must match the fixture's `real-failure` provenance.
`pnpm kota eval record-agent-step` is the authoring surface (`--step <id>`
walks the source commit diff; `--judge <label>` lifts `<runDir>/<label>.json`;
`--source-commit-sha` handles pre-SHA sources).
The adapter routes workflow-step prompts by `Step:` and judge prompts by
leading header (table in `replay-harness.ts`); new judges add an entry
there and author via `--judge <label>`.

Time-sliding fixtures use the runner templating pass:
`{{NOW_MINUS_HOURS:N}}` and `{{NOW_MINUS_MINUTES:N}}` rewrite to ISO
timestamps before `Date.now()` at materialization.

## Boundaries

- Scoring, fixture-run contract, runner, gate decisions, and persisted
  cadence baseline all live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through a
  typed completion event; regressions through the typed regression event;
  per-run evidence as run artifacts; baseline holds one row.
- No cost signals leak into agent-facing context (autonomy rule).
- Fixture working dirs materialize under the OS tmpdir, never inside the
  repo. Always go through the harness entry points; do not
  mutate a fixture's initial state at runtime.
- The replay adapter is module-owned. Do not add a parallel fixture-
  scoped mock layer under `src/core/agent-harness/`; the replay adapter
  registers through the standard registry and is swapped in via the
  normal env-var seam the subprocess executor already owns.
