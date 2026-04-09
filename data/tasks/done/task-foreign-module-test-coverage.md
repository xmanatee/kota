---
id: task-foreign-module-test-coverage
title: Add test coverage for the foreign module stdio transport
status: done
priority: p3
area: reliability
summary: The foreign module modules (foreign-module.ts, foreign-module-stdio.ts) are critical code paths for integrating external tools via stdio, but have no test coverage. Failures surface as silent hangs or cryptic subprocess errors at runtime.
created_at: 2026-03-30T22:38:33Z
updated_at: 2026-03-31T00:00:00Z
---

## Problem

`src/foreign-module.ts` and `src/foreign-module-stdio.ts` implement the stdio
transport layer that launches, manages, and communicates with external tool processes.
This is a critical integration path — broken foreign modules surface as silent hangs,
zombie processes, or opaque subprocess errors with no stack trace pointing into KOTA code.

Neither file has a corresponding test file. Any regression in subprocess lifecycle
management (spawn, message framing, teardown, error propagation) goes undetected until
runtime.

## Desired Outcome

Unit tests covering:
- Happy-path: subprocess spawned, tool-call request sent, response received and parsed.
- Subprocess error on spawn (missing binary, permission denied) → clean error thrown.
- Subprocess exits unexpectedly mid-request → request rejects with descriptive error.
- Graceful teardown: `stop()` closes the subprocess without hanging.
- Message framing edge cases: partial writes, oversized payloads if applicable.

Use a fake subprocess (e.g., `child_process` mock or an in-process echo script) so tests
run without an actual external binary.

## Constraints

- No changes to production code purely for testability (design for natural boundaries).
- Tests must be deterministic and fast — no real subprocess spawns in CI unless already
  accepted elsewhere in the test suite.
- If the existing design makes unit testing impractical without refactoring, scope the task
  to also include the minimal refactor needed to enable testing (extract subprocess
  abstraction boundary).

## Done When

- `src/foreign-module.test.ts` or `src/foreign-module-stdio.test.ts` exists with
  tests covering the scenarios above.
- All new tests pass in CI.
- No existing tests regressed.
