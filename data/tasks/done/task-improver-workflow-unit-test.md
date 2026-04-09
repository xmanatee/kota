---
id: task-improver-workflow-unit-test
title: Add WorkflowTestHarness unit test for the improver workflow
status: done
priority: p3
area: testing
summary: The improver workflow has non-trivial when predicates (commit runs when improve succeeds, request-restart runs when commit commits) but has no workflow.test.ts. The workflows/AGENTS.md guidance requires each workflow with predicate logic to have a harness-based unit test.
created_at: 2026-04-01T03:11:00Z
updated_at: 2026-04-01T03:11:00Z
---

## Problem

`src/modules/autonomy/workflows/improver/workflow.ts` has two conditional steps:
- `commit` runs only when the `improve` agent step succeeds (`stepSucceeded("improve")`)
- `request-restart` runs only when the `commit` step has committed (`stepCommitted("commit")`)

These predicates have no unit coverage. The `WorkflowTestHarness` was introduced specifically for testing this kind of step-skip logic, and `docs/workflows/AGENTS.md` now requires a `workflow.test.ts` for every workflow that has non-trivial `when` predicates. The improver is the only built-in workflow that lacks this test.

## Desired Outcome

`src/modules/autonomy/workflows/improver/workflow.test.ts` uses `WorkflowTestHarness` to verify:
1. When the `improve` step fails, `commit` and `request-restart` are skipped.
2. When `improve` succeeds and `commitWorkflowChanges` returns `{ committed: true }`, `request-restart` runs.
3. When `improve` succeeds but `commitWorkflowChanges` returns `{ committed: false }`, `request-restart` is skipped.

## Constraints

- Follow the pattern in `src/modules/autonomy/workflows/builder/workflow.test.ts`.
- Mock `../commit.js` (for `commitWorkflowChanges`) as needed.
- Do not change production code; test-only mocks go in the test file.

## Done When

- `src/modules/autonomy/workflows/improver/workflow.test.ts` exists and all tests pass.
- `npm test` remains green.
