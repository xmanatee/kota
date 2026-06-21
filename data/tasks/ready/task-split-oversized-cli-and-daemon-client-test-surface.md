---
id: task-split-oversized-cli-and-daemon-client-test-surface
title: Split oversized CLI and daemon-client test surfaces
status: ready
priority: p3
area: architecture
summary: The eval-harness subprocess executor cleanup passed, but its builder run still reported source-file-size warnings for src/core/server/daemon-client.test.ts, src/modules/cli/navigator.test.ts, and src/modules/eval-harness/cli.test.ts. Split cohesive test support or narrower test files without changing daemon-client, CLI navigator, or eval-harness behavior.
created_at: 2026-06-21T09:44:50.364Z
updated_at: 2026-06-21T09:44:50.364Z
---

## Problem

The eval-harness subprocess executor cleanup passed, but its builder run still reported source-file-size warnings for src/core/server/daemon-client.test.ts, src/modules/cli/navigator.test.ts, and src/modules/eval-harness/cli.test.ts. Split cohesive test support or narrower test files without changing daemon-client, CLI navigator, or eval-harness behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-21T09-29-33-710Z-progress-reviewer-wbbfrq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-21T09-29-33-710Z-progress-reviewer-wbbfrq.

review verdict: needs-steering
review summary: KOTA is mostly on track but needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 8, Meta 0, Unclassified 9. The batch closed the intended Safety, Platform, and eval-harness cleanup work, with clean dead-letter, fan-out, operator-journey, and evaluator-calibration signals, but the final cleanup run still left three touched oversized test files with source-size warnings and no active duplicate task.

Evidence ids:

- run:2026-06-21T08-53-09-482Z-builder-e8cjyw
- task:task-split-oversized-eval-harness-subprocess-executor-f
- git:commit:74b66fd7d460

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts are recorded; builder source-size diagnostics no longer warn on the three cited touched test files, or a typed narrow exception is justified; focused daemon-client, CLI navigator, and eval-harness CLI tests pass; typecheck, lint, and validate-tasks pass.
