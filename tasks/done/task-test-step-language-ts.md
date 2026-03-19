---
id: task-test-step-language-ts
title: Add direct unit tests for step-language.ts and step-language-condition.ts
status: done
priority: p1
area: manifest
summary: Write direct unit tests for all exported functions in step-language.ts and step-language-condition.ts, covering all branches.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/manifest/step-language.ts` and `src/manifest/step-language-condition.ts` export several complex pure functions with no direct test coverage. These are covered indirectly at best. Direct unit tests would catch regressions across the many branches (numeric comparison, regex match failure, nested collection access, template interpolation, operator precedence).

## Desired Outcome

`src/manifest/step-language.test.ts` covers all exported functions from both files with meaningful branch coverage.

## Constraints

- Import `evaluateStepLanguageCondition` via `step-language.ts` (it re-exports from `step-language-condition.ts`).
- No test branches in production code.

## Done When

- `src/manifest/step-language.test.ts` exists and all tests pass.
- `npm test` passes without any new failures.
