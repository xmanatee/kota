---
status: done
---

# Split oversized repo-tasks routes and route tests

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

- `.kota/runs/2026-06-22T01-35-30-662Z-builder-9bklnw/source-size-line-counts.txt` records before/after line counts: `routes.ts` went from 747 lines to 129, and `routes.test.ts` was split from 550 lines into focused files no larger than 126 lines plus 60 lines of shared test helpers.
- Builder source-size diagnostics against the staged changes reported `OK: changed source files are under source-size warning thresholds`.
- Focused validation passed: `pnpm exec vitest run src/modules/repo-tasks/routes-status.test.ts src/modules/repo-tasks/routes-state.test.ts src/modules/repo-tasks/routes-show.test.ts src/modules/repo-tasks/routes-create.test.ts src/modules/repo-tasks/routes-maintenance.test.ts src/modules/repo-tasks/repo-tasks-operations.test.ts src/modules/repo-tasks/task-dependencies.test.ts`; `pnpm run typecheck`; `pnpm run lint`; `pnpm run validate-tasks`.
- Real-index validation and final staging passed after the manual task-state updates: `pnpm run validate-tasks`; `git add -A`.
