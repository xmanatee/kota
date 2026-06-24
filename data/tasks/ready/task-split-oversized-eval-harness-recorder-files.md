---
id: task-split-oversized-eval-harness-recorder-files
title: Split oversized eval-harness recorder files
status: ready
priority: p3
area: modules
summary: The source-grounded synthesis fixture build passed, but its builder source-size review reported fresh advisories for src/modules/eval-harness/recorder.test.ts at 600 lines and src/modules/eval-harness/recorder.ts at 386 lines. Split cohesive recorder helpers or focused test fixtures, or record a narrow typed exception, without changing eval-harness recording behavior.
created_at: 2026-06-24T05:03:09.725Z
updated_at: 2026-06-24T05:03:09.725Z
---

## Problem

The source-grounded synthesis fixture build passed, but its builder source-size review reported fresh advisories for src/modules/eval-harness/recorder.test.ts at 600 lines and src/modules/eval-harness/recorder.ts at 386 lines. Split cohesive recorder helpers or focused test fixtures, or record a narrow typed exception, without changing eval-harness recording behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-23T23-00-00-013Z-progress-reviewer-nsrtbs.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-23T23-00-00-013Z-progress-reviewer-nsrtbs.

review verdict: needs-steering
review summary: Narrow steering needed. Balance is Product 0, Safety 3, Platform 1, Meta 8, Unclassified 8; the main Platform fixture task completed with critic and replay evidence, but the latest builder left new eval-harness recorder source-size advisories not covered by the two existing ready cleanup tasks.

Evidence ids:

- scope:8nrg1m:run:2026-06-24T03-44-31-181Z-builder-8zj16u
- scope:8nrg1m:task:task-add-a-source-grounded-research-synthesis-fixture-t
- scope:8nrg1m:git:commit:0011826c9e9f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line-count or builder source-size evidence shows src/modules/eval-harness/recorder.test.ts and src/modules/eval-harness/recorder.ts no longer trigger the 300-line advisory, or records a narrow justified source-size exception; focused eval-harness recorder tests, typecheck, and task validation pass.
