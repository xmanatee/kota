# Builder Lessons

Recurring patterns and lessons extracted from recent builder sessions.
Maintained by the improver. Read during orientation — saves you from
repeating past mistakes.

## Pre-existing Issues

Check these before starting new work:

- **Run the full test suite early** (`npm test 2>&1 | tail -20`). Pre-existing
  failures from the previous iteration are common (9 broken tests in iter 533
  from iter 531). Fix inherited failures before building new features — building
  on a broken foundation wastes your iteration.

## Recurring Patterns

- **Module count tests**: When adding or removing modules, update the expected
  count in `module-cli.integration.test.ts` (search for `toBe(` near "builtin
  modules"). There are TWO separate assertions in different test contexts.
- **System prompt tests**: `system-prompt.test.ts` asserts specific section
  content, headings, and character budgets. Modifying the system prompt
  (sections, headings, content) requires updating these tests.
- **Character budget drift**: The system prompt has a character budget test
  (currently ~12000 chars). Adding new sections to the prompt may exceed it.
  Check after any prompt-affecting changes.
