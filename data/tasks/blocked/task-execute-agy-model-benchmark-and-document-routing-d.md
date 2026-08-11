---
id: task-execute-agy-model-benchmark-and-document-routing-d
title: Execute AGY model benchmark and document routing decision evidence
status: blocked
priority: p1
area: architecture
task_class: Platform
summary: Run candidate Google models through the eval suite, record full trace and rubric evidence in .kota/runs/<run-id>/agy-model-routing/, and validate the Antigravity preset mapping.
depends_on: [task-build-reusable-agy-model-evaluation-suite-in-eval, task-enforce-agy-model-readiness-gates-and-dynamic-pres]
created_at: 2026-08-08T10:52:38.954Z
updated_at: 2026-08-11T12:22:08.075Z
---

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

## Unblock Precondition

```text
kind: operator-capture
path: .kota/runs/2026-08-11T11-04-08-772Z-builder-l9gfun/agy-model-routing
description: In an operator-controlled environment with authenticated AGY and a running Docker-compatible engine, provide a KOTA/AGY candidate image plus an internal Google provider-egress network and proxy, then run `pnpm kota eval agy-models --candidate gemini-3.6-flash --candidate gemini-3.1-pro --repeats 3 --effort max --container-executable docker --container-image <image> --container-kota-binary-path /opt/kota/bin/kota.mjs --provider-egress-network <network> --provider-egress-proxy http://<proxy-host>:<port> --keep --json`. Capture the full transcript, availability evidence, suite report, all three scenario traces per repeat and candidate, changed-path reports, rubric verdicts, and final routing decision at this path. The capture must use the real antigravity-cli adapter and must not use replay, host execution, a fake container runtime, or fallback.
```

## Status (2026-08-11 builder preflight)

The live suite could not start in this builder environment. Docker 29.3.1 is
installed, but the default context has no reachable engine; no configured
Google provider-egress network, proxy, or candidate image is available. AGY
1.1.12 is installed, but `agy models` exits 1, so harness-managed authentication
and `gemini-3.6-flash-high` availability cannot be verified. The screened
preflight transcript and fail-closed `needs-more-data` decision are recorded in
`.kota/runs/2026-08-11T11-04-08-772Z-builder-l9gfun/evidence/artifacts/agy-model-routing/`.
