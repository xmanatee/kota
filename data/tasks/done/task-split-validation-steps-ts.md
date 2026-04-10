---
id: task-split-validation-steps-ts
title: Split workflow/validation-steps.ts (417 lines) into step-type modules
status: done
priority: p2
area: workflow
summary: validation-steps.ts validates each workflow step type (agent, code, tool, emit, restart, parallel) in a single 417-line file. Extract each step-type validator into its own module under workflow/step-validators/ and re-export from an index, leaving validation-steps.ts as a thin barrel or removing it entirely.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/core/workflow/validation-steps.ts` is 417 lines — well over the 300-line limit.
It contains separate validation functions for every workflow step type, all colocated.

## Desired Outcome

Each step-type validator lives in its own focused file (e.g. `validate-agent-step.ts`,
`validate-code-step.ts`, `validate-tool-step.ts`, etc.) under a `step-validators/`
subdirectory. Imports throughout the codebase continue to work via an index barrel.

## Constraints

- Follow the existing module pattern in the workflow directory
- Keep the public import surface unchanged (re-export from an index barrel)

## Done When

- No file in the affected area exceeds 300 lines.
- All existing tests pass.
- Type checking and lint pass.
