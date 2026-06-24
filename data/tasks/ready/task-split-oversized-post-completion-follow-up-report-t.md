---
id: task-split-oversized-post-completion-follow-up-report-t
title: Split oversized post-completion follow-up report test
status: ready
priority: p3
area: autonomy
summary: The CI/build-failure reporting build passed, but its builder source-size review reported src/modules/autonomy/report/post-completion-followups.test.ts at 384 lines. Split focused fixture cases or extract local test helpers so future post-completion follow-up changes stay reviewable without changing report behavior.
created_at: 2026-06-24T02:56:19.507Z
updated_at: 2026-06-24T02:56:19.507Z
---

## Problem

The CI/build-failure reporting build passed, but its builder source-size review reported src/modules/autonomy/report/post-completion-followups.test.ts at 384 lines. Split focused fixture cases or extract local test helpers so future post-completion follow-up changes stay reviewable without changing report behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-24T02-48-30-938Z-progress-reviewer-1w3n1r.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-24T02-48-30-938Z-progress-reviewer-1w3n1r.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Platform 0, Safety 2, Meta 8, Unclassified 10; the batch landed useful autonomy governance work, but the latest CI/build-failure reporting build left a new untracked source-size advisory on the post-completion follow-up test surface.

Evidence ids:

- event:evtj-000000097255
- task:task-classify-ci-and-integration-failures-in-post-compl
- git:commit:dec8ab729c78

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line-count or builder source-size evidence shows src/modules/autonomy/report/post-completion-followups.test.ts no longer triggers the 300-line advisory, or records a narrow justified exception; focused post-completion follow-up and render tests pass along with typecheck and task validation.
