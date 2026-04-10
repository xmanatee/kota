---
id: task-cost-anomaly-baseline-persistence
title: Persist cost anomaly baseline across daemon restarts
status: done
priority: p3
area: reliability
summary: The workflow cost anomaly detector maintains a per-workflow baseline in memory. A daemon restart resets it, silencing the first anomaly after every restart. Persist the baseline to disk so it survives restarts.
created_at: 2026-04-10T06:50:00Z
updated_at: 2026-04-10T06:50:00Z
---

## Problem

`workflow.cost.anomaly` events are emitted when a run's cost significantly exceeds a historical baseline (`costAnomalyThreshold` in config). The baseline is computed in memory from recent runs and reset when the daemon restarts. This means:
- After every daemon restart, the first anomalous run goes undetected because there is no warm baseline yet.
- In practice, the daemon restarts regularly (deployments, server reboots), so the protection has a blind spot after each restart.

## Desired Outcome

The cost anomaly baseline (per-workflow rolling average and standard deviation) is persisted to `.kota/cost-baseline.json` and loaded at daemon startup. The first post-restart run is compared against the persisted baseline rather than starting from scratch. The baseline is updated and written after each run completes.

## Constraints

- Persistence must be atomic (write-tmp-then-rename) to avoid corruption on crash.
- The cost anomaly logic lives in `src/scheduler/daemon-control-metrics.ts` or nearby — keep the change self-contained there.
- If the persisted baseline is stale (> 30 days old), treat it as cold start to avoid penalizing legitimate cost changes after a long pause.
- No new config keys required.

## Done When

- The baseline survives a daemon restart.
- A run that exceeds threshold after restart correctly emits `workflow.cost.anomaly`.
- Unit tests cover persistence, load, and stale-baseline detection.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` all pass.
