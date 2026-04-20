---
id: task-harden-eval-harness-design-against-infrastructure-noise
title: Harden eval-harness design against infrastructure noise
status: backlog
priority: p2
area: autonomy
summary: The planned autonomy-eval harness must treat infrastructure configuration as a first-class confounder — separate resource allocation from kill thresholds, repeat fixture runs, and report pass@k vs pass^k — otherwise benchmark drift from the host environment will dominate signal from KOTA-side changes.
created_at: 2026-04-20T00:30:00.000Z
updated_at: 2026-04-20T00:30:00.000Z
---

## Problem

Anthropic's Mar 2026 "Quantifying infrastructure noise in agentic coding
evals" post shows that container resource configuration alone can swing
scores on Terminal-Bench 2.0 by 6 percentage points — larger than the
gap used to rank competing models. Single-run scores on a shared host
therefore cannot distinguish a regression from environment drift.

The existing `task-build-an-outcome-eval-harness-for-autonomy-workflo`
task specifies cost and latency budgets per fixture and a cadenced run,
but it does not mandate:

- Separate guaranteed resource allocation from the hard kill threshold
  (today identical-value caps would be invisible in the harness
  contract).
- Repeated runs per fixture to average out temporal variance (API
  latency time-of-day drift is documented in the same post).
- Explicit reporting of `pass@k` (capability) versus `pass^k`
  (consistency), and a policy for when each is the load-bearing metric.

Without these constraints baked in, the first KOTA eval numbers will
look rigorous and mislead follow-up decisions.

## Desired Outcome

- The eval-harness module (when it lands under
  `src/modules/eval-harness/`) has a typed fixture-run contract that
  captures resource profile, run index within a repeat set, and
  timing envelope per run.
- Aggregate scoring reports `pass@k` and `pass^k` side by side for each
  fixture set, not a single averaged number.
- The harness's module `AGENTS.md` documents the infrastructure-noise
  rule: "leaderboard differences below ~3pp deserve skepticism without
  documented infrastructure matching," translated into KOTA's fixture
  workflow.
- Regressions flagged by the harness require both a drop in `pass^k`
  beyond the noise band and a stable resource profile before they gate
  autonomy changes.

## Constraints

- This task narrows the design of the existing eval-harness task; it
  does not itself land runtime code unless the harness module already
  exists when this task is pulled.
- Do not add a separate metrics store for noise reporting — reuse the
  harness's run-artifact path and the existing telemetry surface.
- Do not hardcode a single resource-headroom multiplier; the calibration
  must be empirical per host class and recorded with the run.
- No cost signals leak into agent-facing context (existing rule).

## Done When

- The eval-harness module's fixture-run type carries resource profile,
  repeat index, and timing envelope, and the scoring layer reports
  `pass@k` and `pass^k` separately.
- The module's `AGENTS.md` documents the infrastructure-noise rule and
  the KOTA regression-gate threshold.
- A focused test covers the noise-band decision so a single flaky run
  cannot gate an autonomy change.
