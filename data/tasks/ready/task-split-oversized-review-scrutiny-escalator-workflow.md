---
id: task-split-oversized-review-scrutiny-escalator-workflow
title: Split oversized review-scrutiny escalator workflow test
status: ready
priority: p3
area: autonomy
summary: The latest review-scrutiny repair passed, but builder metadata reported src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts at 386 lines after a 95-line change. Split focused scenarios or extract local test helpers so future review-scrutiny repairs stay reviewable without changing escalator behavior.
created_at: 2026-06-24T00:33:26.660Z
updated_at: 2026-06-24T00:33:26.660Z
---

## Problem

The latest review-scrutiny repair passed, but builder metadata reported src/modules/autonomy/workflows/review-scrutiny-escalator/workflow.test.ts at 386 lines after a 95-line change. Split focused scenarios or extract local test helpers so future review-scrutiny repairs stay reviewable without changing escalator behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T00-28-30-365Z-progress-reviewer-c9q5e0.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T00-28-30-365Z-progress-reviewer-c9q5e0.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Platform 0, Safety 2, Meta 8, Unclassified 9. The review-scrutiny repair sequence is making progress and current monitors are quiet, but the latest repair left a new source-size advisory on the review-scrutiny escalator workflow test surface.

Evidence ids:

- run:2026-06-24T00-13-26-267Z-builder-vrx0ib
- git:commit:ab9a5bf6c523

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line-count or builder source-size evidence shows the touched review-scrutiny escalator test surface no longer triggers the source-size warning; focused review-scrutiny escalator tests pass.
