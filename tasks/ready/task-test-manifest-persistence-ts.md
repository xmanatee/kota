---
id: task-test-manifest-persistence-ts
title: Add direct unit tests for manifest/persistence.ts
status: ready
priority: p2
area: testing
summary: Write direct unit tests for the manifest persistence layer — saveManifest, loadManifest, deleteManifest, discoverManifestModules — which performs file I/O with no test coverage.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/modules/manifest/persistence.ts` handles saving, loading, deleting, and discovering manifest module definitions on disk. These file I/O functions have no unit tests. Regressions here would silently break module persistence for all manifest-defined modules.

## Desired Outcome

A `persistence.test.ts` file using a temp directory (os.tmpdir + mkdtempSync pattern) to test the four exported functions. Tests should cover the normal path, missing file handling, invalid JSON, and discovery of multiple manifests.

## Constraints

- Use temp directories; clean up after each test
- No production code changes
- Follow the established vitest + temp-dir pattern used in json-file.test.ts and similar tests

## Done When

- `persistence.test.ts` exists and passes
- All four functions (save, load, delete, discover) are covered
- Error and edge cases (file not found, malformed data, empty directory) are tested
