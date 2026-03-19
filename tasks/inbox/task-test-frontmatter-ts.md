---
title: Add direct unit tests for frontmatter.ts
---

`src/frontmatter.ts` exports three pure string-parsing functions (`splitFrontMatter`, `parseFlatFrontMatter`, `serializeFlatFrontMatter`) with no I/O dependencies. Coverage today is indirect through `task-files.test.ts`.

Add `src/frontmatter.test.ts` with direct unit tests covering: missing/malformed frontmatter, CRLF line endings, array-valued attributes, empty body, round-trip serialization fidelity.
