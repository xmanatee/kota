---
id: task-fix-flaky-test-suite
title: Fix persistently failing tests across the test suite
status: ready
priority: p2
area: testing
summary: 58 tests across 18 test files consistently fail in CI — process tool, repl-session, MCP client, init/git context, memory, and others. These failures forced the improver to make verify-test globally non-blocking, which now masks real regressions. The underlying tests need to be fixed or properly stabilized.
created_at: 2026-03-25
updated_at: 2026-03-25
---

## Problem

Three consecutive builder runs failed at `verify-test` with 58 tests failing across 18 files. The failures are not caused by builder changes — they predate recent commits. The improver worked around this by making `verify-test` globally non-blocking, but this masks future real regressions.

Failing areas:
- `src/tools/process.test.ts` — process state shows "running" when it should show "exited"; timing-sensitive output/stderr/buffer tests
- `src/repl-session.test.ts` — timeout/interrupt handling tests; Python SIGINT test
- `src/mcp/client.test.ts` — race condition on second callTool after server crash
- `src/init.test.ts` — git context tests (likely affected by running inside a worktree or dirty repo state)
- `src/workflows/builder/gather-context.test.ts` — test timeout at 5000ms; tests that create real git commits
- `src/memory/sqlite-memory.test.ts`, `src/tools/code-exec.test.ts`, `src/e2e.test.ts`, and others

## Desired Outcome

- The full test suite passes reliably in both clean and dirty repo states.
- `verify-test` can be restored as a blocking step in the builder.
- Tests that are inherently slow or environment-dependent are either fixed, given proper timeouts, or explicitly skipped with justification.

## Constraints

- Do not add production-code flags or hooks to make tests easier.
- Fix root causes: timing, environment assumptions, missing cleanup.
- For tests that truly cannot be made reliable (e.g. they test real OS signal delivery), add a clear skip with a comment rather than removing them.

## Done When

- `npm test` passes with no more than a handful of known-flaky tests (well-documented).
- `verify-test` can be re-added to `RESTART_VERIFICATION_STEP_IDS` in `src/workflows/shared.ts` without causing false failures.
- The improver's `continueOnFailure: true` workaround on `verify-test` can be reverted.
