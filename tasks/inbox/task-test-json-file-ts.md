Add direct unit tests for `src/json-file.ts`.

`json-file.ts` is 71 lines with two exported functions and one exported error class:
- `readOptionalJsonFile<T>(path)` — returns null if absent, throws `JsonFileError` on read/parse failure
- `writeJsonFileAtomic(path, value, serialize?)` — writes via tmp+rename, creates dirs, throws `JsonFileError` on failure
- `JsonFileError` — typed error with `path`, `operation`, and descriptive `message`

Use `os.tmpdir()` for all file I/O. Cover:
- `readOptionalJsonFile`: missing file → null, valid JSON → parsed value, invalid JSON → JsonFileError(parse), read failure (unreadable path) → JsonFileError(read)
- `writeJsonFileAtomic`: writes valid JSON with default serializer, creates missing parent dirs, custom serializer is called, write failure → JsonFileError(write)
- `JsonFileError`: name, path, operation, message fields are set correctly
