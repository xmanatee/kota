# Eval Harness Module

This module hosts KOTA's autonomy eval harness: scoring, regression gating,
and fixture execution. CLI, HTTP, and cadence share one path.

## Infrastructure Noise Rule

Resource config can swing scores past model-ranking gaps, so fixture runs carry:

- **Resource profile** — host class; CPU allocation/kill threshold; matching memory.
- **Execution preflight** — backend, requested/observed/enforced profile,
  diagnostics, and gate eligibility. Host subprocess is non-gating without
  verified CPU/memory facts.
- **Repeat index/total** — fixtures run k times; k=1 is non-gating.
- **Timing** — budget, duration, deadline hits, and clean return.

## Pass@k vs Pass^k

The harness reports `pass@k` (fixtures with any successful run, capability) and
`pass^k` (fixtures whose every run passed, consistency). Gate on `pass^k` and
track capability on `pass@k`.

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

Calibrate the band per host class; record it per run. Defaults live in code.

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

Predicates score final state, never self-report. Extend union/evaluator with new
kinds. Agent verifiers and Git/shell predicates/metrics require fail-closed
offline containers; hard-limit memory/CPU/PIDs/FDs; strip credentials. Only the
candidate tree is writable; existing `initial/scripts/` are immutable scorer
overlays. Launch/cleanup async; cases run sequentially.

Fixtures also declare `preRunExpectations`: initial predicate results. At
least one must be `expected: "fail"`; mismatches are fixture config errors.

Persistent multi-round fixtures use `mode: "multi-round"` and ordered
`rounds`; the runner preserves one workspace and records round outcomes.
Skill-ablation fixtures use `mode: "skill-ablation"` for no-skill control
and explicit-skill treatments, recording prompt/provenance evidence under
`skillAblation`. Single-workflow fixtures are default when `mode` is absent.

Objective metrics are deterministic fixture evidence, not a second runner.
Predicates gate unless a fixture defines a metric threshold; compare only
compatible profiles. Metric errors fail passing runs; failed runs retain them
and let the eval set continue.

`verifierCalibration` runs before workflow execution with fixture-owned setup,
writes `verifier-calibration.json`, and fails as fixture errors. Use
`acceptedAlternatives` only for real broad-answer-space risk; cases must be
deterministic valid alternatives.

Code-health diagnostics are opt-in source-tree evidence for
`codeHealthDiagnostics.sourceGlobs`: baseline/checkpoint metrics and bounded
growth, duplication, and complexity warnings. They are advisory; predicates own
pass/fail.

## Baseline Persistence And Regression Surfacing

Cadence alone persists the latest accepted aggregate in KOTA state, keyed by
project and host class; the first run records without gating. `not-gated`
advances the baseline even for comparison drift, while `gated` holds it until a
clear run or manual reset.

On `gated`, cadence emits a typed regression event; a bridge workflow forwards
it through attention. Consumers subscribe to the typed event, not generic
completion events. CLI/HTTP callers own comparison; auto-resolution is
cadence-only.

Accepted baselines include the eval-set run-configuration fingerprint and
operator summary. Configuration drift starts a fresh baseline without treating
score movement as quality signal.

## Runner Lifecycle And Execution Paths

Each run materializes a fresh tmpdir, uses a pluggable executor, evaluates
predicates, and emits an artifact. Run fixtures sequentially; parallel replicas
corrupt profiles and noise comparisons. `gated`: do not ship; rerun on the same
host class. `not-gated` from profile drift or a small sample: rerun correctly.

Three paths share the same `runFixture` + subprocess executor:

- **Smoke gate (`pnpm test`)** — `replay-smoke.test.ts` runs one shipped
  `*-agent-call-replay` fixture at `repeats=1`, no baseline, so workflow-layer
  regressions fail standard tests, including autonomy repair-loop checks.
  Cover workflow-step and judge-prompt branches. Live-LLM fixtures stay out.
- **Cadence (`eval-harness-cadence`)** — weekly `repeats=k`; gating requires
  the complete container backend, and verifiers never use the evaluator host.
- **CLI (`pnpm kota eval run`)** — operator-driven; caller owns comparison,
  no baseline persistence.

## Recorded Agent-Step Replay

Agent-call fixtures ship one recording per call under
`<fixtureDir>/recordings/<id>.json`. The subprocess executor sets
`KOTA_EVAL_HARNESS_REPLAY_ROOT`; the module swaps the `claude-agent-sdk` slot
for a replay adapter. Replay subprocesses force `KOTA_PRESET=claude`; container
subprocesses bind-mount the recording root read-only at the same absolute path.
Production selection is unchanged.

The adapter expands `{{runDir}}`, applies operations to the fixture workspace,
and stages them for repair checks. Recording `sourceRunId` must match
`real-failure` provenance.
`pnpm kota eval record-agent-step` is the authoring surface (`--step <id>`
walks the source commit diff; `--judge <label>` lifts `<runDir>/<label>.json`;
`--source-commit-sha` handles pre-SHA sources).
The adapter routes workflow-step prompts by `Step:` and judge prompts by
leading header (table in `replay-harness.ts`); new judges add an entry there
and author via `--judge <label>`.

Time-sliding fixtures use the runner templating pass:
`{{NOW_MINUS_HOURS:N}}` and `{{NOW_MINUS_MINUTES:N}}` rewrite to ISO
timestamps before `Date.now()` at materialization.

## AGY Model Evaluation

`kota eval agy-models` runs planning, scoped coding, and repair through
`antigravity-cli`. Candidate, container, and provider-egress flags are required;
Google egress and KOTA `max`/AGY `high` are fixed, without fallback or replay.
Probe `agy models` only in the configured candidate container and reject
unavailable candidates before fixtures. Artifacts record traces, changed paths,
rubrics, and verdicts; instruction checks cite fixture sources. The native-CLI
allowlist proxy chains to the container provider proxy, never public addresses.

## Fixture Candidate Mining

Candidate mining is advisory: `kota eval fixture-candidates` writes bounded
JSON/Markdown from local `.kota/runs/` with rejection codes, but never creates
fixtures or affects pass@k/pass^k.

## Boundaries

- Scoring, runner contracts, gates, and cadence baseline live in this module.
- No parallel metrics store: use typed completion/regression events, run
  artifacts, and one baseline row.
- No cost signals leak into agent-facing context (autonomy rule).
- Fixture workspaces use the OS tmpdir; auth stays behind the adapter's
  non-secret locator.
- Replay is module-owned and swaps through the standard harness registry/env seam;
  do not add fixture mocks under `src/core/agent-harness/`.
