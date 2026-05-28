---
id: task-record-eval-harness-run-configuration-fingerprints
title: Record eval-harness run configuration fingerprints before baseline comparison
status: ready
priority: p2
area: modules
summary: Add a strict eval-harness run configuration fingerprint covering the active preset, resolved harness/model evidence, fixture manifest, and KOTA source identity so cadence baselines compare only like-for-like run populations instead of treating harness or fixture drift as model quality signal.
created_at: 2026-05-28T03:21:01.917Z
updated_at: 2026-05-28T03:21:01.917Z
---

## Problem

KOTA's eval-harness cadence compares the fresh aggregate score against the
persisted baseline using repeat count, execution preflight, resource profile,
and the `pass^k` noise band. That protects against host-resource drift, but it
does not make the rest of the run population explicit. A cadence run can be
compared to a prior baseline after a preset swap, resolved harness/model
change, fixture manifest change, or KOTA source/runtime change, and the gate
will still treat any score movement as model or workflow quality signal as long
as the host resource profile matches.

The raw evidence exists in pieces: workflow agent-step artifacts record resolved
`harness` and `model`, fixtures have typed specs, and git can identify the KOTA
source state. None of that is reduced into one strict eval-set configuration
fingerprint in `eval-set-report.json`, the cadence event, or
`.kota/eval-harness/baseline.json`. Operators therefore have to inspect child
run directories by hand to notice that two baseline populations are not
like-for-like.

## Desired Outcome

Every eval-set report carries a strict run-configuration artifact and stable
fingerprint that describes the population being scored. At minimum it covers:

- active preset id and resolved preset-owned harness/model tier map used by the
  cadence process;
- the fixture manifest being scored, including fixture ids and a stable hash of
  the loaded fixture specs relevant to scoring;
- KOTA source identity for the running checkout or built distribution, with an
  explicit `unavailable` state when git facts cannot be read;
- resolved harness/model evidence observed from agent-step child run artifacts,
  summarized without requiring operators to open each nested run directory;
- the existing resource and execution profile facts already used for gating.

Baseline persistence records the same fingerprint beside the aggregate. Cadence
baseline comparison refuses to gate or roll a prior score forward as a normal
quality comparison when the configuration fingerprint is not comparable; it
surfaces a typed non-gating reason and records the new baseline as a fresh
population only through an explicit cold-start/first-run path. CLI and HTTP
callers expose the fingerprint summary and mismatch reason through the existing
eval-harness result shape.

## Constraints

- Keep the work inside `src/modules/eval-harness/` plus the narrow core/preset
  reads needed to identify the active preset. Do not add a second metrics store,
  benchmark runner, or ClawBench import.
- Reuse existing run artifacts and typed fixture specs. Do not shell out through
  ad hoc text parsing when a source-mode API already exposes the data.
- The fingerprint must be deterministic across path differences that do not
  affect scoring. Absolute tmp paths, timestamps, and run ids should not change
  the comparable hash.
- Treat missing source identity, missing child run metadata, or mixed resolved
  harness/model evidence as explicit diagnostic states, not as silent defaults.
- Preserve the current resource-profile gate. The new configuration comparison
  is additive; it does not replace the host-resource noise rule or
  `pass@k`/`pass^k` semantics.
- Do not leak cost or model-choice optimization into agent-facing prompts.
- Do not unblock or modify `task-add-cross-preset-runtime-parity-gate`; that
  blocked task is operator-captured end-to-end parity evidence, while this task
  is eval-harness baseline comparability.

## Done When

- `eval-set-report.json` includes a typed `runConfiguration` section with a
  stable `fingerprint`, a human-readable summary, and machine-readable
  components for fixture manifest, active preset, source identity, resolved
  harness/model evidence, resource profile, and execution profile.
- `.kota/eval-harness/baseline.json` persists the accepted baseline's
  `runConfiguration` fingerprint and enough summary fields for an operator to
  understand later mismatches.
- Baseline assessment returns a typed non-gating comparison outcome when prior
  and candidate run configurations are not comparable, with tests covering
  preset drift, fixture-manifest drift, and unavailable source identity.
- CLI/HTTP eval run outputs surface the fingerprint summary and configuration
  mismatch reason without adding a new operator command.
- Existing pass/fail scoring, fixture diagnostics, objective metrics, and
  resource-profile gating continue to behave unchanged for comparable
  configurations.

## Source / Intent

Explorer run `2026-05-28T03-19-08-401Z-explorer-u2y02y` started with an empty
actionable queue (`ready=0`, `doing=0`) and only two backlog tasks blocked by
`task-enable-autonomous-access-to-auth-walled-sources-so`. The strategic
blocked alternatives surfaced by `inspect-queue` are all operator-capture waits
and not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The never-seen watchlist entry `https://github.com/openclaw/clawbench` was
checked because it is explicitly tracked as an eval-methodology signal.
ClawBench Core v1 describes a full-stack agent benchmark that records harness,
configuration, and model effects, highlights drift from OpenClaw platform
versions and provider routing, and separates reproducible task behavior from
absolute score drift. A prior completed task already covered its per-fixture
signal-to-noise/low-signal warning gap:
`task-report-per-fixture-signal-to-noise-diagnostics-in-`. The remaining
nonduplicative KOTA gap is baseline comparability across eval-harness run
configuration changes.

Local overlap check:

- `src/modules/eval-harness/fixture-run.ts` records resource profiles and
  execution preflight facts per run.
- `src/modules/eval-harness/eval-set.ts` writes `eval-set-report.json` with
  runs, per-fixture scoring, fixture diagnostics, aggregate score, control
  coverage, objective metrics, resource profile, and execution profile, but no
  strict run-configuration fingerprint.
- `src/modules/eval-harness/baseline-store.ts` persists aggregate score,
  resource profile, timestamp, and artifact path, but not the preset, fixture
  manifest, source identity, or resolved harness/model population.
- Workflow child run artifacts already record resolved `harness` and `model`;
  this task should summarize that evidence rather than re-deriving it from
  workflow definitions.

## Initiative

Autonomy eval harness: regression gates should compare like-for-like run
populations and label configuration drift explicitly, so operators can trust
cadence results as quality signal rather than artifact of preset, fixture, or
source drift.

## Acceptance Evidence

- Focused tests pass for the new run-configuration fingerprinting and baseline
  comparability behavior, for example:
  `pnpm test src/modules/eval-harness/eval-set.test.ts src/modules/eval-harness/baseline-assessment.test.ts src/modules/eval-harness/baseline-store.test.ts`.
- A CLI transcript under `.kota/runs/<run-id>/` shows
  `pnpm kota eval run --fixture <fixture> --repeats 1`, and the corresponding
  `eval-set-report.json` contains `runConfiguration.fingerprint` plus summary
  fields.
- A fixture or unit test demonstrates a configuration mismatch (fixture
  manifest or preset drift) returns the typed non-gating reason instead of
  producing a misleading gated/not-gated quality comparison.
