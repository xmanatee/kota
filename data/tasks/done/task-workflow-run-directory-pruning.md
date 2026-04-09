---
id: task-workflow-run-directory-pruning
title: Prune old workflow run directories automatically
status: done
priority: p3
area: workflow
summary: The .kota/runs/ directory grows unboundedly as workflow runs accumulate. Add a pruning step that removes run directories older than a configurable retention window, keeping disk use bounded for long-running daemons.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Every workflow run writes artifacts to `.kota/runs/<run-id>/`. Over weeks of autonomous operation, this accumulates into many directories with agent message logs, inputs, and metadata. There is no cleanup mechanism, so disk use grows indefinitely.

## Desired Outcome

- The workflow runtime (or a dedicated code step in a workflow) prunes run directories older than a retention window (default: 7 days).
- Pruning should preserve the `WorkflowRuntimeState` file and any run still referenced in it as active or pending.
- A `kota workflow prune` CLI command (or flag on `kota workflow list`) could trigger pruning on demand.

## Constraints

- Never delete the current active run or any pending/queued run.
- Retain at least the N most recent runs per workflow regardless of age (configurable, default: 10).
- Pruning errors must not crash the daemon.

## Done When

- Old run directories are removed on a schedule or on demand.
- Active and pending runs are never deleted.
- Disk use is bounded for long-running deployments.
- Tests verify the retention logic.
