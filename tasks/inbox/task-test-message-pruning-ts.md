---
id: task-test-message-pruning-ts
title: Add direct unit tests for message-pruning.ts
status: inbox
priority: p2
area: testing
summary: Add unit tests for buildToolCallMap, generateSummary, and pruneMessages in src/message-pruning.ts
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/message-pruning.ts` has no direct unit tests despite being a shared utility that controls context-window cost for long-running sessions.

## Desired Outcome

Full test coverage of all three exported functions with no mocking needed (pure functions).

## Constraints

- No I/O or external deps — all tests operate on in-memory message arrays
- Cover all branches: pruneable vs non-pruneable tools, minLength threshold, keepRecent window, image-bearing results, error results, string vs array content

## Done When

- `buildToolCallMap`: extracts tool_use blocks from assistant messages, ignores user messages and string content
- `generateSummary`: returns correct summary for each pruneable tool type (file_read, grep, glob, repo_map, web_fetch, web_search, delegate) and default fallback
- `pruneMessages`: returns zero stats when messages.length <= keepRecent; prunes only old messages; skips results shorter than minLength; skips error results; skips non-pruneable tools; prunes image-bearing results regardless of size; returns accurate prunedCount and charsSaved
- All existing tests still pass, typecheck and lint clean
