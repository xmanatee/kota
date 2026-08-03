---
id: task-prove-the-repaired-improver-lifecycle-in-a-runtime
title: Prove the repaired improver lifecycle in a runtime probe
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Exercise the combined committing and non-committing lifecycle through a fresh local improver probe or representative integration fixture and record the required autonomy change decision.
depends_on: [task-repair-improver-commit-artifact-handoff-for-commit, task-model-and-verify-explicit-improver-non-committing]
created_at: 2026-08-03T17:10:23.306Z
updated_at: 2026-08-03T17:10:23.306Z
---

## Problem

    Unit coverage alone cannot prove that real run-directory handoff, staged state, repair ordering, and terminal classification compose correctly in the workflow runtime.

## Desired Outcome

    A runtime-level execution demonstrates that committing work records and consumes the expected artifact, non-committing work terminates explicitly, and neither path exhausts repair on commit-message-exists.

## Constraints

- Use a fresh local runtime probe when safe; otherwise use a representative integration fixture that exercises the same run-directory and repair-loop boundaries.
- Do not broaden infrastructure exclusions or weaken commit guards to make the probe pass.
- Preserve the direct-commit prohibition and canonical workflow commit path.
- If the repair changes workflow, prompt, harness, reviewer, or repair-loop behavior materially, include autonomy-change-decision.json with baseline and candidate references, evidence, rollout, and verdict.

## Done When

- A committing probe terminates without commit-message-exists exhaustion and records a meaningful commit-message.txt in the active run directory before commit validation.
- A supported non-committing probe terminates with its explicit result and without entering commit-only repair checks.
- The existing commit guard, stageability, and focused improver suites pass together.
- The runtime artifacts identify the terminal outcome, repair-check sequence, and artifact path used by each probe.
- The required autonomy change decision records baseline, candidate, evidence, rollout plan, and a promote, hold, rollback, or needs-more-data verdict.

## Source / Intent

    Provide operator-auditable proof that the repaired improver can resume reliable monitored autonomy execution and unblock the Product or Safety intent behind the original repair chain.

Decomposed from `task-repair-improver-commit-message-artifact-lifecycle` after builder run `2026-08-03T14-59-50-722Z-builder-xmr4em` exhausted repair.

## Product / Safety Link

This recovery task unblocks the Product or Safety intent preserved by `task-repair-improver-commit-message-artifact-lifecycle`.

## Initiative

    Autonomy fleet health: recurring local workflow failures should graduate into deterministic, reviewable repair work.

## Acceptance Evidence

- Fresh probe run IDs or representative integration artifacts for both committing and explicitly non-committing outcomes.
- Combined focused test output for improver lifecycle, commit guards, and stageability.
- The resulting autonomy-change-decision.json when required by the implemented scope.
