---
status: done
---

# Split oversized agent harness guard implementation

## Result

Extracted the harness guard command classifiers into `src/core/agent-harness/guard-command-classifiers.ts` and left `src/core/agent-harness/guards.ts` focused on guard composition and permission decisions. The public classifier exports remain available through `guards.ts`.

## Problem

The workflow shell teardown guard hardening passed, but its builder run reports src/core/agent-harness/guards.ts at 351 lines over the 300-line source-size guideline. Extract cohesive command-classification or workflow-shell guard helpers while preserving the fixed destructive-command coverage.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-22T17-58-45-679Z-progress-reviewer-hiddnt.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-22T17-58-45-679Z-progress-reviewer-hiddnt.

review verdict: needs-steering
review summary: Needs one narrow maintainability follow-up. Balance: Product 0, Safety 2, Platform 0, Meta 1, Unclassified 17. Recent safety/security work landed with passing review evidence and monitors are not showing drift or failure patterns, but the latest guard hardening left src/core/agent-harness/guards.ts over the source-size guideline.

Evidence ids:

- run:2026-06-22T17-58-29-878Z-builder-jsx9sc
- git:commit:dc40341b0651
- task:task-security-review-the-workflow-shell-teardown-guard-

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Line counts: `src/core/agent-harness/guards.ts` reduced from 351 lines to 199 lines; extracted classifier file is 167 lines, so both touched source files are below the 300-line guideline.
- Focused tests passed: `pnpm test src/core/agent-harness/guard-command-classifiers.test.ts src/core/agent-harness/guards.test.ts src/modules/claude-agent-harness/executor.test.ts`.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` passed.
- `pnpm run validate-tasks` passed after staging the task/source diff.
- Run artifact: `.kota/runs/2026-06-22T18-44-41-698Z-builder-75g8xf/source-size-evidence.txt`.
