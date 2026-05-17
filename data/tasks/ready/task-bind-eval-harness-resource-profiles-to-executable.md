---
id: task-bind-eval-harness-resource-profiles-to-executable
title: Bind eval-harness resource profiles to executable isolation
status: ready
priority: p2
area: modules
summary: Make eval-harness resource profiles describe the executor's actual isolation and limits, not only caller-supplied metadata, so cadence baselines cannot compare unverified host conditions.
created_at: 2026-05-17T06:26:45Z
updated_at: 2026-05-17T06:26:45Z
---

## Problem

The eval-harness correctly treats resource profiles as load-bearing for
pass^k regression gating, but today those profiles are caller-supplied facts
rather than facts produced or verified by the executor. The cadence workflow
hardcodes `autonomy-cadence` as 2 CPU cores and 4096 MB memory, and the
subprocess executor remaps `HOME` / `KOTA_PROJECT_DIR` and enforces only a
wall-clock budget. It does not prove that CPU allocation, CPU kill threshold,
memory allocation, or memory kill threshold match the recorded profile.

That weakens the noise-band rule. If the runtime records a stable resource
profile while the actual host or process limits drift, the baseline gate can
roll forward or fire on evidence that is not comparable. KOTA should not
copy a full external benchmark harness, but the resource profile fields it
already records need to be executable or explicitly marked non-gating.

## Desired Outcome

Eval-harness fixture execution has one typed execution-profile contract that
connects the recorded `ResourceProfile` to the actual executor backend. A run
either:

- executes inside an isolation backend that can enforce or deterministically
  verify the declared CPU and memory allocation / kill thresholds, or
- records an explicit unverified host profile and refuses to use that run for
  baseline gating.

The cadence path should no longer hardcode a resource profile without an
executor preflight. CLI and HTTP callers may still provide requested resource
settings, but the harness normalizes them into a verified execution profile
or fails loudly before scoring.

## Constraints

- Keep this inside `src/modules/eval-harness/`; do not move benchmark or
  container concerns into core.
- Extend the existing fixture runner and subprocess executor. Do not add a
  parallel eval runner, a second metrics store, or a new benchmark DSL.
- Container support can be optional, but optional means capability-detected
  and explicit. A missing Docker/container backend should produce a typed
  preflight result, not a silent downgrade to host execution.
- Preserve the current fixture isolation guarantees: fixture working dirs stay
  outside the operator repo, `HOME` and `KOTA_PROJECT_DIR` remain remapped,
  and credentials do not leak into artifacts.
- Keep cost signals out of agent-facing context. Resource profile facts are
  operator/evaluator evidence only.
- Do not weaken the existing noise-band and pass^k rules. This task makes
  their inputs more trustworthy; it does not change the scoring policy.

## Done When

- Eval-harness defines a typed execution-profile/preflight result that records
  backend kind, requested profile, observed or enforced profile, and whether
  the profile is gate-eligible.
- The cadence workflow derives its `ResourceProfile` from that preflight
  instead of using a static constant as the gating truth.
- The subprocess executor either enforces the declared CPU/memory limits
  through a supported isolation backend or marks the run as unverified and
  non-gating.
- Per-run artifacts include the execution profile, backend diagnostics, and
  the reason a run was gate-eligible or non-gating.
- Tests cover: verified profile accepted for gating, requested/observed
  mismatch rejected before baseline comparison, missing optional isolation
  backend producing a typed non-gating result, and current host-subprocess
  fixture execution still remapping `HOME` / `KOTA_PROJECT_DIR`.
- The eval-harness local `AGENTS.md` is updated only if the execution-profile
  contract changes the operator-facing rule; do not add a backend catalog.

## Source / Intent

Explorer run `2026-05-17T06-24-25-706Z-explorer-vx65fa` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:
`task-add-cross-preset-runtime-parity-gate`,
`task-capture-an-end-to-end-coding-task-parity-artifact-`,
`task-enable-autonomous-access-to-auth-walled-sources-so`, and
`task-introduce-a-rich-cli-rendering-abstraction-for-all`.

The scaffold command was attempted first:

```sh
pnpm kota task create "Bind eval-harness resource profiles to executable isolation" --state ready --area modules --priority p2 --summary "Make eval-harness resource profiles describe the executor's actual isolation and limits, not only caller-supplied metadata, so cadence baselines cannot compare unverified host conditions."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://github.com/princeton-nlp/SWE-bench` now redirects to
  `https://github.com/SWE-bench/SWE-bench`; its README still emphasizes
  Docker-based reproducible evaluations, standardized evaluation output, and
  explicit host resource requirements for credible SWE-bench runs.

Local evidence:

- `src/modules/eval-harness/fixture-run.ts` defines CPU and memory allocation
  and kill-threshold fields and treats profile equality as a gating
  precondition.
- `src/modules/eval-harness/cadence-workflow.ts` currently records a static
  `CADENCE_PROFILE` for all cadence runs.
- `src/modules/eval-harness/subprocess-executor.ts` remaps `HOME` and
  `KOTA_PROJECT_DIR` and enforces a wall-clock budget, but it does not verify
  or enforce CPU/memory allocation and kill thresholds.

## Initiative

Eval-harness reliability: regression gates should compare autonomy outcomes
only when the execution environment facts they depend on are true and
auditable.

## Acceptance Evidence

- Focused test transcript for eval-harness preflight, execution-profile, and
  cadence gating behavior, for example
  `pnpm test src/modules/eval-harness/runner.test.ts src/modules/eval-harness/cadence-workflow.test.ts src/modules/eval-harness/noise-band.test.ts`.
- A run artifact under `.kota/runs/<run-id>/eval-resource-profile-preflight.json`
  or equivalent showing a fixture run's requested profile, observed/enforced
  profile, backend kind, and gate eligibility.
- Queue validation passes with the new ready task and no duplicate task id.
