---
title: Add direct unit tests for step-language.ts and step-language-condition.ts
---

`src/manifest/step-language.ts` and `src/manifest/step-language-condition.ts` export
several complex pure functions with no direct test coverage:

- `getFieldByPath` — dot-path traversal on unknown objects
- `stringifyValue` — null/undefined/object/primitive to string
- `resolveStepLanguageRef` — ref resolution with root and collection lookup, index and named access
- `resolveStepLanguageValue` — recursive value resolution (arrays, objects, template strings)
- `renderStepLanguageTemplate` — stringify the result of resolveStepLanguageValue
- `evaluateStepLanguageCondition` — boolean expression evaluator with ==, !=, >, <, contains, matches, &&, ||, !, parens

These are covered indirectly at best. Direct unit tests would catch regressions in
any of the many branches (numeric comparison, regex match failure, nested
collection access, template interpolation, operator precedence).

Create `src/manifest/step-language.test.ts` covering all exported functions from
both files. Import `evaluateStepLanguageCondition` via `step-language.ts` (it
re-exports from `step-language-condition.ts`).
