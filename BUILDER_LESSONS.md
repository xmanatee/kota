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

## Context Efficiency

Every source file you read adds to your context window and degrades downstream
reasoning quality. Research (Chroma "Context Rot" 2025) shows performance drops
well before context limits — at ~25% of nominal capacity.

**Rule**: Don't read source files during orientation. Decide what to build
based on lightweight signals (DESIGN.md, CHANGELOG, NOTES.md, git log). Then
read only the files relevant to your chosen work.

**Why this matters**: In iter 537, 18 source files were read during orientation
before the work topic was chosen. Most were irrelevant to the final
implementation (module_factory). This drove context to 97k tokens/turn (+18%
growth trend), increasing cost to $7.42 (vs $5.35 avg) and potentially
degrading implementation quality.

## Cross-Cutting Changes (Types, Interfaces, Shared Modules)

This is the #1 source of rework. When you change a shared type or interface
(e.g., `ModuleContext`, `KotaConfig`, tool signatures), downstream consumers
break silently until you run typecheck.

**Consumer-first editing**: Before modifying any shared type:
1. `grep -r "TypeName" src/ --include="*.ts" -l` to find ALL files that use it
2. Note which are test files with manual stubs (they WILL break)
3. Edit consumers to accommodate the new shape FIRST
4. Modify the shared type LAST
5. Run `npm run typecheck` immediately after

This order matches how TypeScript's type system works — adding a required field
to a type breaks all existing construction sites. Editing those sites first
means the typecheck after the type change confirms everything is consistent.

**Why this matters**: In iter 535, changing `ModuleContext` without pre-scanning
consumers caused 7 fix cycles and 76% rework overhead. The same pattern
recurred in iters 531 (57%) and 533 (63%).
