---
id: task-test-extracted-utils
title: Add direct unit tests for extracted utility modules
status: done
priority: p2
area: testing
summary: Add isolated unit tests for three utility modules that were extracted during recent file splits and currently only have integration test coverage.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Several utility modules extracted during recent file splits have no dedicated test files. They are currently only covered by integration tests of their parent modules.

Modules to address:
- `src/data/html-extract-utils.ts` — `decodeEntities`, `stripTags`, `removeBlocks`, `convertCodeBlocks`, `convertTables`, `convertHeadings`, `convertInlineElements`, `finalCleanup`
- `src/tools/http-request-utils.ts` — `safePositiveInt`, `formatBytes`, `looksLikeJson`, `isBinaryContentType`, `formatTabularJson`
- `src/scheduler/daemon-state.ts` — `assertDaemonState`

## Desired Outcome

Each module has a dedicated unit test file covering all exported functions with meaningful cases.

## Constraints

All three modules contain only pure functions with no integration dependencies.

## Done When

- `src/data/html-extract-utils.test.ts` exists and passes
- `src/tools/http-request-utils.test.ts` exists and passes
- `src/scheduler/daemon-state.test.ts` exists and passes
- `npm test` passes in full
