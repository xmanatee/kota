---
status: done
---

# Add direct unit tests for schedule-parser.ts

## Problem

`src/core/daemon/schedule-parser.ts` contains three pure, deterministic functions (`getPendingSummary`, `projectHash`, `parseTime`) with no direct unit test coverage. These functions handle time parsing, project hashing, and summary generation for the scheduler — logic that is easy to break silently during refactors.

## Desired Outcome

A `schedule-parser.test.ts` file that directly tests the three exported functions with representative inputs, edge cases, and error conditions. Tests should follow the existing pattern (vitest, describe/it/expect, no mocks for pure functions).

## Constraints

- Tests must be direct unit tests of the exported functions, not integration tests
- No production code changes; only add a test file
- Follow the established vitest test pattern already used in the codebase

## Done When

- `schedule-parser.test.ts` exists alongside the source file
- `npm test` passes with meaningful coverage of all three functions
- Key branches and edge cases are exercised (invalid input, boundary values, etc.)
