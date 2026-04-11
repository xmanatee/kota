---
id: task-verify-module-first-front-complete
title: Verify the module-first cleanup front is complete
status: blocked
priority: p1
area: governance
summary: Final audit task that should run only after the focused autonomy, root cleanup, resource disposition, and validation tasks are complete.
blocked_reason: Waiting for the focused dependency tasks listed in this file to be completed first.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

The current front of work intentionally splits runtime correctness, queue
health, resource-disposition recovery, and source-tree modularization into
focused tasks. Without a final audit task, those tasks can each finish locally
while the overall front still has gaps or inconsistent documentation.

## Desired Outcome

After the dependency tasks finish, perform one final high-level audit and close
any missed gaps with focused follow-up tasks or small direct fixes.

## Dependencies

- `task-fix-explorer-refresh-starvation`
- `task-reduce-empty-queue-noop-churn`
- `task-clean-root-kota-runtime-artifact`
- `task-record-historical-resource-packet-disposition`
- `task-consolidate-root-data-file-helpers-into-core`
- `task-consolidate-root-loop-context-helpers`
- `task-consolidate-root-tool-execution-helpers`
- `task-move-vercel-stream-into-vercel-adapter`
- `task-finalize-src-root-entrypoint-allowlist`
- `task-add-root-helper-boundary-validation`
- `task-audit-daemon-single-instance-liveness`
- `task-trim-architecture-migration-notes`

## Constraints

- Do not start this task until the listed dependencies are done or explicitly
  dropped with a clear reason.
- Do not turn this into another large implementation task. If significant work
  remains, create or promote focused tasks.
- Check evidence in code, docs, task state, and recent `.kota/runs/` metadata.
- Prefer direct verification over repeating prompt guidance.

## Done When

- All dependency tasks are done or intentionally dropped with clear reasons.
- The task queue has no unresolved gaps from this front of work.
- Explorer can perform substantive empty-queue research again.
- Root `src/` production files are limited to intentional entrypoints or
  documented thin glue.
- Runtime state lives under `.kota/` with no root `kota/` or `runs/` drift.
- The historical resource packet has durable disposition notes or tasks.
- Docs and local `AGENTS.md` files match the final architecture.
