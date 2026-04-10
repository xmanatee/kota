---
id: task-split-run-store-ts
title: Split workflow/run-store.ts (366 lines) — extract ActiveWorkflowRunHandle
status: done
priority: p2
area: workflow
summary: workflow/run-store.ts is 366 lines containing both WorkflowRunStore (directory management, list/load/delete) and the ActiveWorkflowRunHandle factory with its append/record/finish methods. Extract ActiveWorkflowRunHandle and its builder into a separate module so each file stays under 300 lines.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/core/workflow/run-store.ts` is 366 lines. It contains two distinct responsibilities:
`WorkflowRunStore` (manages the run directory, lists/loads/deletes runs) and the
`ActiveWorkflowRunHandle` type plus its factory logic (append messages, record steps,
write inputs, finish).

## Desired Outcome

`ActiveWorkflowRunHandle` and its factory/builder are extracted to a focused module
(e.g. `active-run-handle.ts`). `WorkflowRunStore` imports and uses it.
Both files stay under 300 lines.

## Constraints

- Keep the public export surface unchanged (re-export `ActiveWorkflowRunHandle` from
  `run-store.ts` if callers import it from there today)
- Do not change run-file format, directory layout, or store behavior

## Done When

- `workflow/run-store.ts` is under 300 lines.
- All existing tests pass.
- Type checking and lint pass.
