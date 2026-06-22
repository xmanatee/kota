---
id: task-split-oversized-core-workflow-executor-and-dispatc
title: Split oversized core workflow executor and dispatch files
status: ready
priority: p3
area: core
summary: The progress-review journal backfill landed successfully but its builder run reported source-size warnings on touched core workflow files: src/core/workflow/run-executor.ts and src/core/workflow/runtime-dispatch.ts. Extract cohesive helpers or record a narrow typed exception while preserving workflow runtime behavior.
created_at: 2026-06-22T07:59:57.099Z
updated_at: 2026-06-22T07:59:57.099Z
---

## Problem

The progress-review journal backfill landed successfully but its builder run reported source-size warnings on touched core workflow files: src/core/workflow/run-executor.ts and src/core/workflow/runtime-dispatch.ts. Extract cohesive helpers or record a narrow typed exception while preserving workflow runtime behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T04-52-56-923Z-progress-reviewer-l2zh4v.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T04-52-56-923Z-progress-reviewer-l2zh4v.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 2, Platform 5, Meta 0, Unclassified 11. The journal-backfill work landed with verification and clean monitors, but the latest builder left touched core workflow files over the source-size guideline with no active duplicate follow-up in the exposed queue evidence.

Evidence ids:

- scope:8nrg1m:run:2026-06-22T06-52-58-622Z-builder-bopz18
- scope:8nrg1m:git:commit:5d34ebdbacbf
- scope:8nrg1m:task:task-split-oversized-cli-and-daemon-client-test-surface

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts are recorded; builder source-size diagnostics no longer warn on src/core/workflow/run-executor.ts or src/core/workflow/runtime-dispatch.ts, or a typed narrow exception is justified; focused core workflow tests plus typecheck, lint, and validate-tasks pass.
