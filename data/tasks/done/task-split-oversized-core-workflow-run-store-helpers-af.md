---
id: task-split-oversized-core-workflow-run-store-helpers-af
title: Split oversized core workflow run-store helpers after run-id hardening
status: done
priority: p3
area: core
summary: The run-id security hardening landed, but the builder run recorded source-size warnings on touched core workflow files: src/core/workflow/run-store.ts remains 516 lines and src/core/workflow/run-executor-utils.ts remains 337 lines. Split cohesive run-store and executor-helper responsibilities into co-located core workflow modules while preserving the run-id validation behavior and public imports.
created_at: 2026-06-20T17:42:07.830Z
updated_at: 2026-06-20T17:57:48.436Z
---

## Problem

The run-id security hardening landed, but the builder run recorded source-size warnings on touched core workflow files: src/core/workflow/run-store.ts remains 516 lines and src/core/workflow/run-executor-utils.ts remains 337 lines. Split cohesive run-store and executor-helper responsibilities into co-located core workflow modules while preserving the run-id validation behavior and public imports.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-20T17-37-12-845Z-progress-reviewer-ex6ekc.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-20T17-37-12-845Z-progress-reviewer-ex6ekc.

review verdict: needs-steering
review summary: Needs steering: Product 0, Safety 2, Platform 4, Meta 2, Unclassified 8. The three build commits landed with verification, but the run-id hardening run left touched core workflow files over the source-size guideline with no open duplicate follow-up.

Evidence ids:

- event:1
- task:task-security-review-workflow-run-ids-accepted-from-que
- git:commit:eb47f51635cf

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Record before/after line counts for src/core/workflow/run-store.ts and src/core/workflow/run-executor-utils.ts, keep extracted helpers co-located under src/core/workflow/, preserve existing public exports/import paths, and pass pnpm exec vitest run src/core/workflow/workflow-run-id-security.test.ts src/core/workflow/run-executor-utils.test.ts src/core/workflow/run-store-recover.test.ts plus pnpm typecheck.
