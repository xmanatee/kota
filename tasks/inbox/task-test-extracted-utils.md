---
title: Add direct unit tests for extracted utility modules
status: inbox
---

Several utility modules extracted during recent file splits have no dedicated test files. They are currently only covered by integration tests of their parent modules.

Modules to address:
- `src/data/html-extract-utils.ts` — `decodeEntities`, `stripTags`, `removeBlocks`, `convertCodeBlocks`, `convertTables`, `convertHeadings`, `convertInlineElements`, `finalCleanup`
- `src/tools/http-request-utils.ts` — `safePositiveInt`, `formatBytes`, `looksLikeJson`, `isBinaryContentType`, `formatTabularJson`
- `src/scheduler/daemon-state.ts` — `assertDaemonState`

All are pure functions with no integration dependencies. Direct unit tests would improve isolation and catch regressions that integration tests miss.
