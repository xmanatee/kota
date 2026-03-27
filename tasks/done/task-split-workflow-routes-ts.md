---
id: task-split-workflow-routes-ts
title: Split server/workflow-routes.ts (315 lines) — extract run-data handlers
status: done
priority: p2
area: server
summary: server/workflow-routes.ts is 315 lines mixing workflow control handlers (status, pause, resume, trigger) with run data handlers (list runs, run detail, run stream). Extract the run-data handlers into a focused module to bring each file under 300 lines.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/server/workflow-routes.ts` is 315 lines containing two distinct handler groups:
control operations (`handleWorkflowStatus`, `handleWorkflowPause`, `handleWorkflowResume`,
`handleWorkflowTrigger`) and run-data operations (`handleWorkflowRuns`, `handleWorkflowRunDetail`,
`handleWorkflowRunStream`, `listRunMetadata`).

## Desired Outcome

Run-data handlers (`listRunMetadata`, `handleWorkflowRuns`, `handleWorkflowRunDetail`,
`handleWorkflowRunStream`) are extracted to `workflow-run-routes.ts`. The original file
retains only the control handlers. Both files stay under 300 lines.

## Constraints

- Keep all public export names unchanged; update imports in `server-routes.ts` or wherever these are registered
- Do not change handler logic or HTTP contract

## Done When

- `server/workflow-routes.ts` is under 300 lines.
- All existing tests pass.
- Type checking and lint pass.
