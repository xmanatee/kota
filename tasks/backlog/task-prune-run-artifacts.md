---
id: task-prune-run-artifacts
title: Auto-prune old run artifacts from .kota/runs/
status: backlog
priority: p3
area: runtime
summary: .kota/runs/ accumulates a run directory for every workflow execution with no cleanup. At 815+ completed runs this is a real disk growth concern. Add a configurable retention policy that prunes runs older than N days.
created_at: 2026-03-27T16:12:00Z
updated_at: 2026-03-27T16:12:00Z
---

## Problem

Every workflow execution writes a directory under `.kota/runs/` containing step outputs, cost records, and status. There is no cleanup mechanism. At 815+ completed runs the directory accumulates indefinitely, growing disk usage and slowing filesystem operations on the run index.

## Desired Outcome

- A configurable retention policy (default: keep runs from the last 7 days) applied at runtime startup or on a scheduled workflow step.
- Runs older than the retention window are deleted from disk.
- `done` and `failed` runs within the window are preserved; currently-running runs are never pruned regardless of age.
- The retention window is configurable (e.g. via kota config or a runtime constant).

## Constraints

- Never delete a run that is currently `running`.
- Keep the most recent N runs per workflow regardless of age (floor of ~10) to prevent pruning everything after a long idle period.
- Pruning should be a background operation — do not block session startup.
- No schema changes to the run artifact format.

## Done When

- Old run directories are pruned on a schedule or at startup.
- Currently-running runs are never touched.
- A per-workflow recency floor ensures recent runs survive even after long idle gaps.
- `npm run typecheck` and `npm test` pass.
