---
id: task-test-history-utils-ts
title: Add direct unit tests for history-utils.ts
status: inbox
priority: p2
area: testing
summary: >
  src/memory/history-utils.ts exposes extractText and countMessages — two pure
  functions with no direct test coverage. Add a focused test file that exercises
  all branches.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/memory/history-utils.ts` contains pure utility functions used by
`history.ts` to process Anthropic `MessageParam` values:

- `extractText(content)` — returns a string from a plain-string content or the
  first text block in a content-block array; returns null otherwise.
- `countMessages(messages)` — counts messages that represent meaningful turns
  (assistant messages and user messages with at least one text block).

Neither function has direct unit tests. They are exercised only through
higher-level integration paths in `history.test.ts`, which means regressions in
edge-case branches (tool-result-only user turns, mixed content blocks) would go
undetected.

## Desired Outcome

A new file `src/memory/history-utils.test.ts` with direct tests covering:

- `extractText`: plain-string content, content-block array with a text block,
  content-block array with no text block (tool_result only), empty array, null
  passthrough for non-matching input.
- `countMessages`: empty list, assistant message counted, user string message
  counted, user message with text block counted, user message with only
  tool_result blocks not counted, mixed list.

## Constraints

- Import directly from `./history-utils.js` (not from `history.js`).
- No mocking required — all functions are pure.
- Follow existing test style (vitest, describe/it/expect).

## Done When

- `src/memory/history-utils.test.ts` exists with tests covering all branches
  above.
- All tests pass (`npm test`).
- Typecheck and lint clean.
