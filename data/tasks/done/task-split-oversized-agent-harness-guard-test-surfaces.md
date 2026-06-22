---
id: task-split-oversized-agent-harness-guard-test-surfaces
title: Split oversized agent harness guard test surfaces
status: done
priority: p3
area: core
summary: The destructive shell guard build passed, but its source-size review reports touched core test files over the 300-line guideline: src/core/agent-harness/guards.test.ts and src/core/workflow/steps/step-executor-agent-capability.test.ts. Extract focused guard/capability test helpers or split scenario groups while preserving coverage.
created_at: 2026-06-22T16:50:50.816Z
updated_at: 2026-06-22T17:54:32.851Z
---

## Problem

The destructive shell guard build passed, but its source-size review reports touched core test files over the 300-line guideline: src/core/agent-harness/guards.test.ts and src/core/workflow/steps/step-executor-agent-capability.test.ts. Extract focused guard/capability test helpers or split scenario groups while preserving coverage.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T16-40-17-534Z-progress-reviewer-1twjvo.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T16-40-17-534Z-progress-reviewer-1twjvo.

review verdict: needs-steering
review summary: Scope 8nrg1m is progressing but needs one narrow maintainability follow-up. Balance: Product 0, Safety 2, Platform 1, Meta 1, Unclassified 16. The safety guard build landed with critic and calibration passes, security review created two ready MCP follow-up tasks, and no new operator-journey risk is surfaced, but the latest builder still left touched core test files over the source-size guideline.

Evidence ids:

- artifact:2026-06-22T16-27-44-328Z-builder-fz1evb:source-file-size-review.json
- artifact:2026-06-22T16-27-44-328Z-builder-fz1evb:run-summary.json
- git:commit:c4ae4de0b2f3

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Run artifact `.kota/runs/2026-06-22T17-46-38-843Z-builder-ysyis2/line-count-evidence.txt` records the before/after line counts and staged source-size result.
- `src/core/agent-harness/guards.test.ts` is 287 lines, and `src/core/workflow/steps/step-executor-agent-capability.test.ts` is 175 lines.
- Staged source-size checks report `OK: changed source files are under source-size warning thresholds`.
- Focused guard and workflow capability tests, `pnpm run typecheck`, `pnpm run lint`, `pnpm run validate-tasks`, and `git diff --cached --check` passed; see `.kota/runs/2026-06-22T17-46-38-843Z-builder-ysyis2/validation-transcript.txt`.
