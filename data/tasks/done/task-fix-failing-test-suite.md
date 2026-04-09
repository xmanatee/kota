---
id: task-fix-failing-test-suite
title: Fix failing test suite blocking builder workflow
status: done
priority: p1
area: testing
summary: The test suite has 32 failures across 19 files, causing every builder run to fail at the verification step. Identify the root causes and restore a green baseline so builder can make progress again.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

Three consecutive builder runs (2026-03-27) have failed at the test verification step. The test runner reports 32 test failures across 19 test files out of ~4920 total tests. Affected areas include `repl-session`, `init`, `history-resume`, `e2e`, and others. At least one failure is a timeout in `src/workflows/explorer/auto-escalate.test.ts`.

The failures appear systemic rather than isolated — multiple unrelated modules fail simultaneously, suggesting a shared root cause (broken setup, recently broken abstraction, or test-environment drift).

## Desired Outcome

- Test suite runs clean (or near-clean) so builder verification passes.
- Root causes are identified, not masked with skips or timeouts.
- Any flaky timeout tests are fixed or annotated with a tracked issue.

## Constraints

- Do not disable or skip tests to hide failures — fix the underlying causes.
- Do not add test-only flags or hooks to production code.
- Keep fixes narrow and scoped to the actual breakage points.

## Done When

- `npm test` (or equivalent) completes with no unexpected failures.
- Builder is able to complete a run and pass the verification step.
