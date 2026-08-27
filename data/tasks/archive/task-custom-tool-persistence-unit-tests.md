---
status: done
---

# Add direct unit tests for custom-tool-persistence.ts

## Problem

`src/core/tools/custom-tool-persistence.ts` exposes several public functions (`validateName`, `normalizeSchema`, `getToolsDir`, `getToolPath`, `saveToDisk`) that are only exercised indirectly through `custom-tool.test.ts`. Direct edge-case coverage of validation logic and path helpers is missing.

## Desired Outcome

A `custom-tool-persistence.test.ts` file that exercises every exported function in isolation, covering boundary cases (name length limits, reserved names, regex edges, schema shape variants, disk I/O).

## Constraints

- No changes to production code.
- Tests must be self-contained and use a temp directory for I/O.

## Done When

- `npm test` passes with the new test file included.
- Every exported function in `custom-tool-persistence.ts` has dedicated tests.
