---
status: done
---

# Add direct unit tests for json-file.ts

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
