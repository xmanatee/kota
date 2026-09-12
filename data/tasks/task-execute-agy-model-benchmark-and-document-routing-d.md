---
status: blocked
priority: p1
depends_on: [task-build-reusable-agy-model-evaluation-suite-in-eval, task-enforce-agy-model-readiness-gates-and-dynamic-pres]
---
# Execute AGY model benchmark and document routing decision evidence

## Current Contract

Prepare and validate the current KOTA/AGY image and internal Google egress/auth
route through existing owners, then run the three-repeat comparison. Missing
image/proxy setup is builder work; a verified unavailable provider credential or
entitlement is a concrete blocker. Retain current-model and requested historical
rows, quota and actual effort behavior. Let measured results determine the routing
decision, including needs-more-data or rejection; the historical request to confirm
a preferred model is not permission to force a favorable verdict or switch production.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

    The preset mapping of Gemini 3.6 Flash for the Antigravity capable tier requires documented, inspectable benchmark evidence proving long-horizon coding and instruction adherence superiority.

## Desired Outcome

    Execute scenario evaluations across candidate models, record per-candidate traces, path diffs, and rubric verdicts under .kota/runs/<run-id>/agy-model-routing/, and confirm the Antigravity preset selection.

## Constraints

- Store complete evaluation artifacts (scenario definitions, traces, path scope, rubric verdicts, final decision) in the run directory.
- Verify that the selected model reaches the real AGY process at maximum effort without fallback.

## Done When

- Run directory under .kota/runs/<run-id>/agy-model-routing/ contains complete scenario traces, changed-path reports, rubric verdicts, and routing decision summary.
- Execution transcript confirms Gemini 3.6 Flash at max effort satisfies KOTA autonomy standards with zero unexplained scope regressions.

## Source / Intent

    Owner direction on 2026-08-07: produce inspectable behavioral evidence confirming Gemini 3.6 Flash as the Antigravity preset default for KOTA autonomy.

Decomposed from `task-validate-agy-model-routing-against-long-horizon-co` after builder run `2026-08-07T01-57-52-891Z-builder-epufuo` exhausted repair.

## Initiative

    Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- Artifact directory under .kota/runs/<run-id>/agy-model-routing/ containing full benchmark reports and decision documentation.
- Transcript verifying selected model execution at max effort via the real AGY CLI adapter.

## Status (2026-08-11 builder preflight)

The live suite could not start in this builder environment. Docker 29.3.1 is
installed, but the default context has no reachable engine; no configured
Google provider-egress network, proxy, or candidate image is available. AGY
1.1.12 is installed, but `agy models` exits 1, so harness-managed authentication
and `gemini-3.6-flash-high` availability cannot be verified. The screened
preflight transcript and fail-closed `needs-more-data` decision are recorded in
`.kota/runs/2026-08-11T11-04-08-772Z-builder-l9gfun/evidence/artifacts/agy-model-routing/`.

## Historical disposition (2026-09-10)

Host Docker engine and AGY authentication/model discovery now work (Docker
29.3.1, AGY 1.1.27). Remove them as current blockers. The shipped AGY default is
now 3.7 Flash, not the historically described 3.6. Keep the requested 3.6/3.1
comparison, and include the actual selected model before claiming current routing
validation. Do not switch the live Codex daemon to run this benchmark.
Use the existing eval agy-models owner and current container options. Candidate
image/AGY authentication and Google internal egress/proxy still need verification;
there is currently no Google provider-egress network. Intrinsic-reasoning models
must not receive unsupported effort flags. Record unavailable rows and quota
without blind retries. Readiness and model listing do not replace benchmark
traces, repeats, rubric evidence or a routing decision.

## Blocked on

```text
kind: operator-capture
path: .kota/runs
description: Task-linked evidence of runtime-authorized contained AGY eval execution capability, or equivalent attributable benchmark execution evidence.
```

The path is a discovery hint for the existing blocked-task reviewer, not a
requirement for manual collection or one capture directory. Equivalent scoped
capability or execution exports can satisfy the prerequisite.

This native builder invocation needs a runtime-authorized container execution
capability to prepare the image and internal Google proxy and run the existing
`eval agy-models` owner. On 2026-09-12, Docker socket access was denied by this
invocation's sandbox. The available tools expose no host execution/export port;
the native request/reply service only validates active task-writer authority.
Reading canonical run exports outside the worktree was also denied. Resume when
the runtime supplies a contained execution capability for this task, or equivalent
attributable execution evidence through an accessible export. Do not grant
candidate code host authority or change the live daemon's preset.

This is an invocation-access prerequisite, not evidence that the host Docker
engine, AGY login, provider credentials, entitlement, or models are unavailable.
Image/proxy preparation remains builder work after that capability is available.

## Current attempt evidence (2026-09-12)

Run `2026-09-12T06-40-57-819Z-builder-n2rhhp` retained evidence under its
runtime-owned `agent/agy-model-routing/` directory:

- `pnpm build` passed; the compiled KOTA payload, lockfile and dependency policy
  are retained in `kota-build.tar.gz` with a SHA-256 digest. This is build input,
  not a prepared or validated Linux KOTA/AGY container image.
- All 15 tests across four focused AGY eval-owner suites passed. They cover
  runner orchestration, scenario instructions and scoring, and container-only
  availability rejection; they do not measure candidate quality.
- The production fixture loader and instruction-source validator accepted all
  three scenarios. `scenarios.json` and 44 hashed source snapshots retain the
  exact planning, scoped-coding and repair inputs.
- `execution-plan.json` pins source revision `9fb05ca587f8` and includes the
  current `gemini-3.7-flash` plus requested `gemini-3.6-flash` and
  `gemini-3.1-pro`, each at KOTA `max` with three planned repeats per scenario.
  Image/network/proxy names are proposed, not observed infrastructure.
- The real eval availability owner stopped at container preflight with Docker
  socket permission denied (`availability-preflight.json`, `docker-probe.json`).
  It never launched `agy models` or a candidate and did not fall back to host
  execution. Empty available-model output therefore means unobserved availability.

Routing disposition: **needs more data**. Zero scenario repeats ran; model/effort
propagation, quota, rubric verdicts, changed paths, `pass@3` and `pass^3` remain
unmeasured. No production routing change or favorable benchmark claim is justified.
The full three-repeat comparison and image/egress/auth validation remain unmet.
