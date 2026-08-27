---
status: done
---

# Add direct unit tests for knowledge-store-helpers.ts

## Problem

`src/memory/knowledge-store-helpers.ts` exports several pure or near-pure
functions that are used by the knowledge store but not directly exercised in
isolation:

- `applyFilters` — chains type, tag, status, and since filters; since uses
  `new Date().getTime()` which can silently pass invalid dates; the case-
  insensitive tag matching uses `.some()` with a nested `.toLowerCase()`
  that is easy to regress.
- `parseKnowledgeFile` — parses front matter from disk, returns null on
  missing `id`, populates `meta` for unknown keys; has multiple null-safety
  branches for each field.
- `findFileByIdInDir` — two-pass lookup (suffix match, then full parse) that
  can silently fall back to the slow path.

These are tested only indirectly through `KnowledgeStore` integration tests.

## Desired Outcome

A `src/memory/knowledge-store-helpers.test.ts` file with direct unit tests
covering at least:

- `applyFilters`: no filters (passthrough), filter by type (case-insensitive),
  filter by tag (case-insensitive), filter by status, filter by since (valid
  date, invalid date ignored), multiple filters combined.
- `parseKnowledgeFile`: missing file (null), no `id` field (null), minimal
  valid entry, unknown meta keys captured, array tags parsed.
- `findFileByIdInDir`: suffix-match fast path, slow-path fallback via id field,
  not found.

## Constraints

- Do not alter production code to support testing.
- Use `mkdtempSync` / `writeFileSync` for file-based cases.

## Done When

- `src/memory/knowledge-store-helpers.test.ts` exists with passing tests.
- `npm test`, `npm run typecheck`, and `npm run lint` all pass.
