---
id: task-test-frontmatter-ts
title: Add direct unit tests for frontmatter.ts
status: done
priority: p2
area: testing
summary: Add src/frontmatter.test.ts with direct unit tests for the three pure string-parsing functions exported from frontmatter.ts.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/frontmatter.ts` exports three pure string-parsing functions (`splitFrontMatter`, `parseFlatFrontMatter`, `serializeFlatFrontMatter`) with no I/O dependencies. Coverage today is indirect through `task-files.test.ts`.

## Desired Outcome

`src/frontmatter.test.ts` exists with direct unit tests covering all three functions.

## Constraints

- Tests must use vitest and match existing test patterns in the repo.
- No production code changes.

## Done When

- `src/frontmatter.test.ts` exists and all tests pass.
- Covered cases: missing/malformed frontmatter, CRLF line endings, array-valued attributes, empty body, round-trip serialization fidelity.
