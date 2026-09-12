---
status: open
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
