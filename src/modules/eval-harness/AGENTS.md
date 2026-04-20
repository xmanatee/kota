# Eval Harness Module

This module hosts KOTA's autonomy eval harness. Its current scope is the
strict scoring and regression-gate contract; the fixture runner, CLI entry,
and HTTP routes land in follow-up work under
`task-build-an-outcome-eval-harness-for-autonomy-workflo`.

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

Fixtures land under `src/modules/eval-harness/fixtures/` (directory added
when the runner does). Each fixture contributes an initial repo state, an
autonomy role to invoke, and a pass/fail predicate that inspects actual
repo state (build/test/lint/file content), not the agent's self-report.
Synthesize the fixture from a real `.kota/runs/` failure when possible —
hypothetical fixtures reintroduce the demystifying-evals anti-pattern.

## How To Read A Regression

A `gated` decision means the change should not ship as-is. Reshape the
change, re-run on the same host class, and compare. If the drop persists
across independent runs with stable resource profiles, the regression is
real. If a `not-gated` decision shows `resource-profile-drift` or
`repeat-count-below-minimum`, rerun with the proper configuration before
drawing conclusions — the current numbers simply do not support a gate
either way.

## Boundaries

- Scoring, fixture-run contract, and gate decisions live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through
  the existing telemetry surface; per-run evidence lives as run artifacts
  under `.kota/runs/`.
- No cost signals leak into agent-facing context (existing autonomy rule).
- When the runner lands, it reuses the workflow runtime, autonomy modes,
  run store, and guardrails — this module does not fork a parallel
  runtime just for evaluation.
