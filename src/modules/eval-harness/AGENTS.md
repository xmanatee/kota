# Eval Harness Module

This module hosts KOTA's autonomy eval harness: scoring, regression gating,
and fixture execution. CLI, HTTP, and cadence share one path.

## Infrastructure Noise Rule

Resource config can swing scores past model-ranking gaps, so fixture runs
must carry:

- **Resource profile** — host class, CPU allocation and kill threshold, with
  matching memory fields.
- **Execution profile preflight** — backend kind, requested/observed/enforced
  profile, diagnostics, and gate eligibility. Host subprocess runs may score
  fixtures, but are non-gating unless an executor verifies CPU/memory facts.
- **Repeat index and total** — fixtures run k times; k=1 is non-gating.
- **Timing envelope** — budget, observed duration, deadline hits, and clean
  returns.

## Pass@k vs Pass^k

The harness always reports both:

- `pass@k` — fraction of fixtures where at least one of k runs passed
  (capability).
- `pass^k` — fraction of fixtures where every run passed (consistency).

Gate rollouts on `pass^k`; track capability on `pass@k`. Reporting only one
loses the distinction.

## Regression Gate Threshold

A candidate change is gated only when all of the following hold:

1. `pass^k` drops beyond the calibrated noise band.
2. Both runs used the same `k`, at or above the gating minimum.
3. The candidate execution preflight is gate-eligible.
4. Baseline and candidate resource profiles are comparable (same host class,
   allocation, and kill thresholds).
5. Baseline and candidate configs are comparable: same active preset, fixture
   manifest, source identity, resolved harness/model evidence, and execution
   profile.

Noise-band drops, repeat-count mismatch, non-gating execution profile,
resource drift, or config drift resolve to typed non-gating evidence.

Calibrate the band per host class and record it with the run. Defaults live in
code.

## Fixture Provenance

Provenance answers "why does this fixture exist?". The loader accepts two
shapes:

- **Real failure** — encodes a past autonomy failure and its source run id.
  Use this for every regression-gated fixture.
- **Smoke fixture** — fails loudly when harness plumbing regresses; a
  written justification keeps the exception honest.

Anything else fails loudly at load time with a typed error naming the fixture.
Fix rejected fixtures; do not work around the loader.

## Predicate Contract

Predicates are small and deterministic. They inspect the final fixture working
directory; agent self-report is never signal. New kinds extend the predicate
union and evaluator.

Fixtures also declare `preRunExpectations`: initial predicate results. At
least one must be `expected: "fail"`; mismatches are fixture config errors.

Persistent multi-round fixtures use `mode: "multi-round"` and ordered
`rounds`; the runner preserves one workspace and records round outcomes.
Skill-ablation fixtures use `mode: "skill-ablation"` for no-skill control
and explicit-skill treatments, recording prompt/provenance evidence under
`skillAblation`. Single-workflow fixtures are default when `mode` is absent.

Objective metrics are deterministic fixture-path evidence, not a second
benchmark runner. Pass/fail gating stays predicate-only unless a fixture adds
a threshold predicate; compare metric deltas only for compatible profiles.

`verifierCalibration` cases run before workflow execution with fixture-owned
setup files, write `verifier-calibration.json`, and fail as fixture
configuration errors.

Code-health diagnostics are opt-in source-tree evidence for fixtures with
`codeHealthDiagnostics.sourceGlobs`. They report baseline/checkpoint
measurements and bounded warning codes for growth, duplication, and complexity
concentration. They are advisory; predicates own pass/fail.

## Baseline Persistence And Regression Surfacing

Only the cadence persists the last accepted aggregate as the next baseline in
the KOTA state root, per-project and per-host-class, never in the repo. First
run records and skips the gate.
`not-gated` rolls the baseline forward, including non-load-bearing comparison
reasons, so regressions compare with the latest accepted result. `gated` holds
the baseline until the next clear run or manual reset.

On `gated`, cadence emits a typed regression event; a bridge workflow forwards
it through attention. Consumers subscribe to the typed event, not generic
completion events. CLI/HTTP callers own comparison; auto-resolution is
cadence-only.

Accepted baselines include the eval-set run-configuration fingerprint and
operator summary. Configuration drift starts a fresh baseline without treating
score movement as quality signal.

## Runner Lifecycle And Execution Paths

Each fixture run materializes initial state into a fresh tmpdir, runs the
workflow through a pluggable executor, evaluates predicates, and emits a
per-run artifact. Fixtures run sequentially; parallel replicas corrupt resource
profiles and noise comparison. `gated` means do not ship as-is; rerun on the
same host class. `not-gated` with profile drift or too small a sample means
rerun with the correct config.

Three paths share the same `runFixture` + subprocess executor:

- **Smoke gate (`pnpm test`)** — `replay-smoke.test.ts` runs one shipped
  `*-agent-call-replay` fixture at `repeats=1`, no baseline, so workflow-layer
  regressions fail standard tests, including autonomy repair-loop checks.
  Cover workflow-step and judge-prompt branches. Live-LLM fixtures stay out.
- **Cadence (`eval-harness-cadence`)** — every shipped fixture, weekly,
  `repeats=k`, owns the persisted baseline and `pass^k` aggregation.
- **CLI (`pnpm kota eval run`)** — operator-driven; caller owns comparison,
  no baseline persistence.

## Recorded Agent-Step Replay

Agent-call fixtures ship one recording per call under
`<fixtureDir>/recordings/<id>.json`. The subprocess executor sets
`KOTA_EVAL_HARNESS_REPLAY_ROOT`; the module swaps the `claude-agent-sdk` slot
for a replay adapter. Replay subprocesses force `KOTA_PRESET=claude`; container
subprocesses bind-mount the recording root read-only at the same absolute path.
Production selection is unchanged.

The adapter substitutes `{{runDir}}` in recorded paths, writes operations to
the fixture working dir, and `git add -A`s them so repair checks see the tree
the real agent produced. Every recording's `sourceRunId` must match the
fixture's `real-failure` provenance.
`pnpm kota eval record-agent-step` is the authoring surface (`--step <id>`
walks the source commit diff; `--judge <label>` lifts `<runDir>/<label>.json`;
`--source-commit-sha` handles pre-SHA sources).
The adapter routes workflow-step prompts by `Step:` and judge prompts by
leading header (table in `replay-harness.ts`); new judges add an entry there
and author via `--judge <label>`.

Time-sliding fixtures use the runner templating pass:
`{{NOW_MINUS_HOURS:N}}` and `{{NOW_MINUS_MINUTES:N}}` rewrite to ISO
timestamps before `Date.now()` at materialization.

## Boundaries

- Scoring, fixture-run contract, runner, gate decisions, and persisted cadence
  baseline all live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through a
  typed completion event, regressions through the typed regression event,
  per-run evidence as artifacts, and baseline as one row.
- No cost signals leak into agent-facing context (autonomy rule).
- Fixture working dirs materialize under the OS tmpdir, never inside the repo.
  Always go through harness entry points; do not mutate a fixture's initial
  state at runtime.
- The replay adapter is module-owned. Do not add a parallel fixture-scoped
  mock layer under `src/core/agent-harness/`; the adapter registers through
  the standard registry and swaps in via the subprocess executor's env seam.
