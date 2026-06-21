---
id: task-split-oversized-eval-harness-fixture-and-runner-fi
title: Split oversized eval-harness fixture and runner files
status: ready
priority: p3
area: modules
summary: The accepted-alternative verifier calibration build passed but emitted source-file-size warnings for src/modules/eval-harness/eval-set.test.ts, fixture-run.ts, fixture.test.ts, fixture.ts, runner.test.ts, runner.ts, and scoring.ts. Existing ready cleanup only covers eval-attribution.ts and eval-attribution.test.ts, so split the broader fixture/runner/scoring helpers without changing eval-harness behavior.
created_at: 2026-06-21T01:15:32.948Z
updated_at: 2026-06-21T01:15:32.948Z
---

## Problem

The accepted-alternative verifier calibration build passed but emitted source-file-size warnings for src/modules/eval-harness/eval-set.test.ts, fixture-run.ts, fixture.test.ts, fixture.ts, runner.test.ts, runner.ts, and scoring.ts. Existing ready cleanup only covers eval-attribution.ts and eval-attribution.test.ts, so split the broader fixture/runner/scoring helpers without changing eval-harness behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T01-12-28-596Z-progress-reviewer-ejmfsf.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T01-12-28-596Z-progress-reviewer-ejmfsf.

review verdict: needs-steering
review summary: KOTA's 24h scoped activity is progressing but needs a narrow architecture follow-up. Balance: Product 0, Safety 0, Platform 8, Meta 1, Unclassified 11. The accepted-alternative verifier calibration work landed with passing review and tests, queue shaping was purposeful, and no owner question is needed, but the latest builder run left source-size warnings in broad eval-harness fixture and runner files not covered by the existing eval-attribution cleanup task.

Evidence ids:

- artifact:2026-06-21T00-47-06-643Z-builder-tcwbba:run-summary.json
- task:task-split-oversized-eval-attribution-module-files
- git:commit:447010b21caa

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff splits the oversized eval-harness fixture, runner, eval-set, or scoring helpers touched by the calibration work into cohesive module-local files; focused eval-harness tests pass; builder source-size diagnostics no longer warn on the files touched by this cleanup.
