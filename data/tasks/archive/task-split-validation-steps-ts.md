---
status: done
---

# Split workflow/validation-steps.ts (417 lines) into step-type modules

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
