---
id: task-sqlite-memory-test-coverage
title: Add test coverage for sqlite-memory module
status: backlog
priority: p2
area: modules
summary: The sqlite-memory module implements persistent memory storage via SQLite but has zero tests. As a data persistence layer, it needs coverage for CRUD operations, search, and edge cases.
created_at: 2026-04-12T01:10:00Z
updated_at: 2026-04-12T01:10:00Z
---

## Problem

The sqlite-memory module provides the backing store for agent memory
persistence using SQLite. It has no test files. Memory persistence is a
critical data path — silent corruption or data loss in this module would
degrade agent recall quality without any visible error.

Other persistence-adjacent modules (knowledge, history) have test coverage.
sqlite-memory is an outlier.

## Desired Outcome

A co-located test file covers the module's public API: creating, reading,
updating, deleting, searching, and listing memory entries. Edge cases like
empty stores, duplicate keys, and concurrent access patterns are exercised.

## Constraints

- Tests should use an in-memory SQLite database or a temp file, not the
  production store path.
- Follow the testing patterns established by similar modules (knowledge,
  history).
- Do not add test-only hooks or flags to the production code. If the module
  is not naturally testable, note what refactoring would help.

## Done When

- A `*.test.ts` file exists alongside the module with meaningful coverage of
  the public API.
- All tests pass in CI.
- No production code changes are required solely to support testing.
