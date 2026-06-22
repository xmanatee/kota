---
id: task-split-oversized-repo-tasks-routes-and-route-tests
title: Split oversized repo-tasks routes and route tests
status: ready
priority: p3
area: modules
summary: The task-show traversal fix passed, but its builder source-size review reported advisory warnings for src/modules/repo-tasks/routes.ts and src/modules/repo-tasks/routes.test.ts. Split cohesive route handlers, route helpers, or test fixtures, or record a narrow typed exception without changing repo task show or traversal behavior.
created_at: 2026-06-22T01:35:26.765Z
updated_at: 2026-06-22T01:35:26.765Z
---

## Problem

The task-show traversal fix passed, but its builder source-size review reported advisory warnings for src/modules/repo-tasks/routes.ts and src/modules/repo-tasks/routes.test.ts. Split cohesive route handlers, route helpers, or test fixtures, or record a narrow typed exception without changing repo task show or traversal behavior.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T01-32-08-638Z-progress-reviewer-hgj18s.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T01-32-08-638Z-progress-reviewer-hgj18s.

review verdict: needs-steering
review summary: KOTA is mostly on track but needs one narrow maintainability follow-up. Balance: Product 0, Safety 3, Platform 5, Meta 0, Unclassified 11. The latest security remediation landed with critic approval and clean dead-letter, operator-journey, fan-out, and calibration signals, but its builder run left new advisory source-size warnings on repo-tasks route files not covered by the existing ready source-size tasks.

Evidence ids:

- artifact:2026-06-22T01-23-37-392Z-builder-vokof4:source-file-size-review.json
- artifact:2026-06-22T01-23-37-392Z-builder-vokof4:run-summary.json
- task:task-security-review-the-task-show-route-accepts-a-deco
- task:task-split-oversized-cli-and-daemon-client-test-surface
- task:task-split-oversized-mcp-client-and-agent-step-source-f
- git:commit:44f84d0f8f72

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before/after line counts are recorded; builder source-size diagnostics no longer warn on src/modules/repo-tasks/routes.ts and src/modules/repo-tasks/routes.test.ts, or a typed narrow exception is justified; focused repo-tasks route, operation, and dependency tests pass; typecheck, lint, and validate-tasks pass.
