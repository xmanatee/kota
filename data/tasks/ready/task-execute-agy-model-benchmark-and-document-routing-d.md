---
id: task-execute-agy-model-benchmark-and-document-routing-d
title: Execute AGY model benchmark and document routing decision evidence
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Run candidate Google models through the eval suite, record full trace and rubric evidence in .kota/runs/<run-id>/agy-model-routing/, and validate the Antigravity preset mapping.
depends_on: [task-build-reusable-agy-model-evaluation-suite-in-eval, task-enforce-agy-model-readiness-gates-and-dynamic-pres]
created_at: 2026-08-08T10:52:38.954Z
updated_at: 2026-08-08T10:52:38.954Z
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
