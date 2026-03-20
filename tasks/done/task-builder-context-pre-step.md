---
id: task-builder-context-pre-step
title: Add gather-context pre-step to builder workflow
status: done
priority: p2
area: workflow
summary: The builder workflow has no context pre-step. The improver and explorer both gained structured gather-context steps that give their agents recent run history, recent commits, and runtime state without tool calls. Adding the same to the builder reduces discovery overhead and gives the build agent awareness of what was recently shipped.
created_at: 2026-03-20
updated_at: 2026-03-20T05:35:41Z
---

## Problem

The builder agent currently starts with only the preflight snapshot (validated task list). It has no structured view of recent run history, recent git commits, or runtime state. To understand what was recently built or whether the system is healthy, it must make tool calls to `git log` and read `.kota/runs/` files. The improver and explorer both have `gather-context` code steps that deliver this pre-packaged; the builder should too.

## Desired Outcome

- A `gather-context` code step runs between `preflight` and `build` in the builder workflow.
- The step captures: recent run summaries (last 10–20 within 24h), recent git commits (last 10), task queue counts by state, and runtime state.
- The agent step receives this as `previousOutput` merged with or alongside the preflight output.
- The builder prompt is updated to reference the pre-packaged context.

## Constraints

- Follow the same pattern as `src/workflows/explorer/gather-context.ts` and `src/workflows/improver/gather-context.ts`.
- Keep the snapshot small — metadata only, no full event logs.
- The `build` step's `when` predicate must continue to gate on `validCount > 0` from preflight, not on gather-context output.
- Do not break the preflight → build data flow; both outputs should be accessible.

## Done When

- `gather-context` step exists between `preflight` and `build` in `builder/workflow.ts`.
- The step output includes recent runs, recent commits, task counts, and runtime state.
- The builder prompt references the pre-packaged context instead of asking for discovery.
- Tests verify the step output shape.
