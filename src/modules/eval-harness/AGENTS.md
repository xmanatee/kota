# Eval Harness Module

This module hosts KOTA's autonomy eval harness: the strict scoring and
regression-gate contract plus the fixture-running surface that applies it.
The CLI, HTTP route, and weekly cadence workflow all reuse one execution
path, so the harness has a single observable runtime rather than three.

## Infrastructure Noise Rule

Container resource config alone can swing benchmark scores past the gap
used to rank models. The harness treats that swing as a first-class
confounder, not statistical noise. Every fixture run must carry:

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

1. `pass^k` drops beyond the calibrated noise band.
2. Both runs used the same `k`, and `k` is at or above the gating minimum.
3. Baseline and candidate resource profiles are comparable (same host
   class, identical allocation and kill thresholds).

A drop inside the noise band, a repeat-count mismatch, or resource-profile
drift resolves to `not-gated` with a typed reason — evidence that the
comparison itself isn't load-bearing, not an error signal.

Operators calibrate the band per host class empirically and record the
calibration alongside the run. Concrete defaults live in code.

## Fixture Provenance

Provenance answers "why does this fixture exist?". The loader accepts
exactly two shapes:

- **Real failure** — the fixture encodes a specific past autonomy failure
  and points at its source run id. Use this for every fixture the harness
  exists to regression-gate against. Fixtures assembled from hypothetical
  tasks reward cosmetic progress on capability the agent already has and
  miss the failure modes the harness exists to catch.
- **Smoke fixture** — the fixture exists to fail loudly when harness
  plumbing itself regresses. This is the narrow exception; a written
  justification is the contract that keeps it honest.

Anything else fails loudly at load time as a typed error that names the
offending fixture. There is no undocumented fallback path, and a fixture
the loader rejects is a contribution error — fix the fixture, do not work
around the loader.

## Predicate Contract

Predicates are intentionally small and deterministic. They inspect the
final fixture working directory; the agent's self-report is never part of
the pass/fail signal. New predicate kinds extend the predicate union and
the evaluator — verification logic does not move into fixture authors.

## Baseline Persistence And Regression Surfacing

The cadence (only the cadence) persists the last accepted aggregate as the
next run's comparison baseline, in the KOTA state root, per-project and
per-host-class, never in the repo. First run records and skips the gate.
`not-gated` rolls the baseline forward — including reasons where the
comparison isn't load-bearing — so regressions are always measured against
the most recent accepted result. `gated` holds the baseline until the next
run clears or an operator resets it manually.

On `gated`, the cadence emits a typed regression event; a dedicated bridge
workflow forwards it through the normal attention channel. Consumers must
subscribe to the typed event, not filter generic completion events by
workflow name. CLI and HTTP callers still own their own comparison —
auto-resolution is cadence-only.

## Runner Lifecycle

Each fixture run materializes its initial state into a fresh tmpdir (runs
never mutate the operator's repo), invokes the workflow through a
pluggable executor, evaluates predicates, and emits a per-run artifact.
The eval-set layer aggregates fixtures × repeats into one report.

Fixtures run sequentially by design — parallel replicas would corrupt the
resource profile recorded per run, breaking the noise-band comparison.

## How To Read A Regression

`gated` means the change should not ship as-is. Reshape, rerun on the same
host class, and compare. If the drop persists across independent runs with
stable resource profiles, the regression is real. `not-gated` with a
resource-profile-drift or repeat-count-below-minimum reason means the
numbers don't support a gate either way — rerun with correct config first.

## Recorded Agent-Step Replay

Fixtures that exercise an agent-call branch ship a recording under
`<fixtureDir>/recordings/<stepId>.json`. Each recording captures a real
past `.kota/runs/<id>/steps/<stepId>.json` response envelope plus the
post-agent file operations the real run produced. The subprocess
executor forwards the fixture directory as
`KOTA_EVAL_HARNESS_REPLAY_ROOT`; the eval-harness module's top-level
registration sees the env var and overrides the `claude-agent-sdk`
harness slot with a replay adapter for that subprocess. Production
selection is unchanged — operator and daemon runs never set the env.

The replay adapter substitutes `{{runDir}}` inside recorded paths with
the current run directory parsed from the agent prompt, writes every
file operation to the fixture working directory, and stages the results
through `git add -A` so downstream repair-loop checks
(`task-queue-valid`, `commit-stageable`) observe the same working-tree
shape the real agent produced with `pnpm kota task {create,move}`.

The loader pins provenance: a fixture with any recording must declare
`real-failure` provenance, and every recording's `sourceRunId` must
match the fixture's `provenance.sourceRunId`. Mismatches, unknown
operation kinds, and unsupported recording versions fail at
`loadFixture` with a typed error naming the offending file. The
`pnpm kota eval record-agent-step --run-id <id> --step <step> --fixture
<id>` CLI extracts a recording from a real run's step artifact,
auto-filling the response envelope and Write-tool side effects; Edit
and Bash mutations (task moves, task creates) are the fixture author's
responsibility to encode as additional `fileOperations`, with the
source run id kept pinned.

Two prompt shapes route through the same adapter: workflow-step
prompts keyed by the `Step:` marker, and judge prompts (today only the
critic) keyed to the fixed id `critic-review`. Judge recordings skip
the workflow-name match because their prompt never names a workflow;
fixtures that drive a workflow through both surfaces ship one recording
per surface.

## Boundaries

- Scoring, fixture-run contract, runner, gate decisions, and the persisted
  cadence baseline all live in this module.
- Do NOT add a parallel metrics store. Aggregate scores surface through a
  typed completion event; regressions through the typed regression event;
  per-run evidence as run artifacts; baseline holds one row.
- No cost signals leak into agent-facing context (autonomy rule).
- Fixture working dirs materialize under the OS tmpdir, never inside the
  operator's repo. Always go through the harness entry points; do not
  mutate a fixture's initial state at runtime.
- The replay adapter is module-owned. Do not add a parallel fixture-
  scoped mock layer under `src/core/agent-harness/`; the replay adapter
  registers through the standard registry and is swapped in via the
  normal env-var seam the subprocess executor already owns.
