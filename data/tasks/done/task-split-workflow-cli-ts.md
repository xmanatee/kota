---
id: task-split-workflow-cli-ts
title: Split workflow-cli.ts into focused sub-modules
status: done
priority: p2
area: workflow
summary: workflow-cli.ts is 636 lines — more than twice the 300-line file limit. It mixes run listing, run display, step inspection, log streaming, pause/resume, abort, and manual-trigger concerns. Splitting it into focused sub-modules will improve readability and make each concern independently testable.
created_at: 2026-03-27
updated_at: 2026-03-27T04:20:00Z
---

## Problem

`src/workflow-cli.ts` has grown to 636 lines by accumulating every workflow CLI subcommand in one file. The functions and types for run listing, run display, log streaming, pause/resume, abort, and manual triggers are all co-located even though they have no meaningful coupling.

`src/core/workflow/step-executor.ts` has a similar problem at 563 lines, mixing repair-loop logic, agent-step execution, code-step execution, and result normalization.

## Desired Outcome

- `workflow-cli.ts` is split into co-located subcommand modules (e.g., `workflow-cli/run-show.ts`, `workflow-cli/run-list.ts`, `workflow-cli/logs.ts`, `workflow-cli/control.ts`). Each file stays under 300 lines.
- `workflow/step-executor.ts` is split by concern (e.g., `step-executor-agent.ts`, `step-executor-code.ts`, `repair-loop.ts` or similar). Each file stays under 300 lines.
- Public APIs are unchanged — imports in callers are updated to new locations.
- All existing tests pass without modification.

## Constraints

- Do not change behavior — this is a pure structural split.
- Keep test files co-located with their source files.
- Update any import paths in `src/` and test files that reference the old locations.

## Done When

- `workflow-cli.ts` and `workflow/step-executor.ts` are each under 300 lines.
- All split files are under 300 lines.
- `npm run typecheck` and `npm test` pass.
