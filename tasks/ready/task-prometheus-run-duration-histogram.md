---
id: task-prometheus-run-duration-histogram
title: Add workflow run duration histogram to Prometheus metrics endpoint
status: ready
priority: p3
area: runtime
summary: The Prometheus metrics endpoint tracks run counts and cost per workflow but not duration. Adding a histogram of run durations per workflow would let operators set latency-based SLOs and alert on slow builder or explorer runs.
created_at: 2026-04-02T03:29:03Z
updated_at: 2026-04-02T03:58:38Z
---

## Problem

`GET /metrics` currently emits `kota_workflow_runs_total` (count per workflow/status),
`kota_workflow_cost_usd_total` (cost per workflow), and live gauges (active runs, queue
depth, sessions, approvals, dispatch paused). Run duration is absent.

When a builder run takes 45 minutes instead of the usual 10, operators have no way to
detect this via their monitoring stack without scraping `GET /workflow/runs` for completed
runs and computing duration externally. This makes it impossible to write a simple
Prometheus alert rule like "p95 builder run > 30m".

## Desired Outcome

A `kota_workflow_run_duration_seconds` summary or histogram (with `workflow` and `status`
labels) is emitted by `GET /metrics`. It should reflect completed runs stored in the
workflow run store — the same data `kota workflow stats` reads from disk.

Reasonable buckets for a histogram: 30s, 2m, 5m, 15m, 30m, 60m, +Inf.

Example output:
```
# HELP kota_workflow_run_duration_seconds Duration of completed workflow runs in seconds
# TYPE kota_workflow_run_duration_seconds histogram
kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="1800"} 12
kota_workflow_run_duration_seconds_bucket{workflow="builder",status="success",le="+Inf"} 14
kota_workflow_run_duration_seconds_sum{workflow="builder",status="success"} 9480
kota_workflow_run_duration_seconds_count{workflow="builder",status="success"} 14
```

## Constraints

- Computed from the existing run store (same source as `kota workflow stats`) — no new
  persistence needed.
- Histogram buckets are fixed at definition time; no config required for this task.
- Compute the histogram at request time from recently-cached run data (same pattern as
  `getWorkflowMetricCounts` in `daemon-control-types.ts`); do not scan the full run store
  on every scrape if the set is large — cache with a short TTL (30s is fine).
- Do not change the existing metric names or labels.
- Document the new metric in the `GET /metrics` section of `docs/DAEMON-API.md`.

## Done When

- `GET /metrics` emits `kota_workflow_run_duration_seconds` histogram buckets per
  workflow name and terminal status (`success`, `failed`, `interrupted`).
- At least one unit test validates histogram output format for a sample run list.
- `docs/DAEMON-API.md` mentions the new metric.
- Existing metrics tests pass unchanged.
