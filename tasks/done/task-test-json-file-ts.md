---
id: task-test-json-file-ts
title: Add direct unit tests for json-file.ts
status: done
priority: p2
area: testing
summary: Add unit tests covering readOptionalJsonFile, writeJsonFileAtomic, and JsonFileError in src/json-file.ts
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/json-file.ts` had no direct unit tests despite being a shared utility used across the codebase.

## Desired Outcome

Full test coverage of the two exported functions and the error class, using `os.tmpdir()` for all file I/O.

## Constraints

- Use `os.tmpdir()` for all file paths
- Cover all three exported symbols: `readOptionalJsonFile`, `writeJsonFileAtomic`, `JsonFileError`

## Done When

- Tests pass for: missing file → null, valid JSON → parsed value, invalid JSON → JsonFileError(parse), read failure → JsonFileError(read)
- Tests pass for: default serializer, missing parent dirs, custom serializer, write failure → JsonFileError(write)
- `JsonFileError` fields (name, path, operation, message) verified
- All 4574 tests pass, typecheck and lint clean
