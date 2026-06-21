---
id: task-split-oversized-eval-harness-entrypoint-and-daemon
title: Split oversized eval-harness entrypoint and daemon-client test
status: ready
priority: p3
area: modules
summary: The latest accepted-alternative calibration build passed but emitted source-file-size warnings for src/modules/eval-harness/daemon-client.test.ts and src/modules/eval-harness/index.ts. The existing ready cleanup task covers fixture, runner, eval-set, and scoring helpers, so split or rehome the eval-harness entrypoint exports and daemon-client test helpers without changing behavior.
created_at: 2026-06-21T02:07:01.288Z
updated_at: 2026-06-21T02:07:01.288Z
---

## Problem

The latest accepted-alternative calibration build passed but emitted source-file-size warnings for src/modules/eval-harness/daemon-client.test.ts and src/modules/eval-harness/index.ts. The existing ready cleanup task covers fixture, runner, eval-set, and scoring helpers, so split or rehome the eval-harness entrypoint exports and daemon-client test helpers without changing behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T01-34-52-321Z-progress-reviewer-idowfy.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T01-34-52-321Z-progress-reviewer-idowfy.

review verdict: needs-steering
review summary: KOTA is progressing, but needs one narrow eval-harness cleanup follow-up. Balance: Product 0, Safety 0, Platform 7, Meta 1, Unclassified 12. The main Platform builder work landed with passing review and replay evidence, while the latest builder run still left source-size warnings on eval-harness entrypoint and daemon-client test files not covered by the existing ready cleanup.

Evidence ids:

- artifact:2026-06-21T01-15-36-093Z-builder-i89vvj:run-summary.json
- task:task-split-oversized-eval-harness-fixture-and-runner-fi
- git:commit:499be2835250

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Diff reduces or splits src/modules/eval-harness/index.ts and src/modules/eval-harness/daemon-client.test.ts so builder source-size diagnostics no longer warn on those files; focused eval-harness daemon-client and entrypoint tests pass; pnpm build and pnpm run validate-tasks pass.
