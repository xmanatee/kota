---
id: task-split-oversized-harness-parity-runner-test-surface
title: Split oversized harness-parity runner test surface
status: ready
priority: p3
area: modules
summary: Recent harness-parity security and observability fixes landed, but both touched src/modules/harness-parity/runner.test.ts and left source-size advisories; the latest run reports the file at 1972 lines. Split cohesive runner test scenarios or record a narrow source-size exception so future harness-parity maintenance does not keep producing untracked advisories.
created_at: 2026-06-28T22:54:53.104Z
updated_at: 2026-06-28T22:54:53.104Z
---

## Problem

Recent harness-parity security and observability fixes landed, but both touched src/modules/harness-parity/runner.test.ts and left source-size advisories; the latest run reports the file at 1972 lines. Split cohesive runner test scenarios or record a narrow source-size exception so future harness-parity maintenance does not keep producing untracked advisories.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T22-51-30-539Z-progress-reviewer-24yiym.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T22-51-30-539Z-progress-reviewer-24yiym.

review verdict: needs-steering
review summary: Mostly successful maintenance progress, but one narrow follow-up is needed. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 13. Recent builders closed the security and observability tasks, while the latest harness-parity work still leaves runner.test.ts above the source-size guideline.

Evidence ids:

- artifact:2026-06-28T22-16-49-836Z-builder-29k8rz:source-file-size-review.json
- run:2026-06-28T22-40-29-521Z-builder-k539ds
- git:commit:6c2da576d299

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts show src/modules/harness-parity/runner.test.ts no longer triggers the source-size guideline, or a narrow typed exception is recorded with rationale; focused harness-parity runner tests pass; typecheck and validate-tasks pass.
