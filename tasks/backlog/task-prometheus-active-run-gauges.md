---
id: task-prometheus-active-run-gauges
title: Add active-run and queue-depth gauges to the Prometheus metrics endpoint
status: backlog
priority: p3
area: runtime
summary: The GET /metrics endpoint exposes cumulative counters but no real-time gauges for how many workflow runs are currently active or queued. Without these, operators cannot alert on stuck workflows or queue buildup using standard Prometheus rules.
created_at: 2026-04-02T01:36:00Z
updated_at: 2026-04-02T01:36:00Z
---

## Problem

`GET /metrics` exposes `kota_workflow_runs_total` (cumulative counter) and
`kota_workflow_cost_usd_total`, but no gauges reflecting current runtime state.
Operators running Grafana/Prometheus dashboards cannot answer:

- "Are there currently any active runs, and for which workflows?"
- "How deep is the run queue right now?"

Without these gauges, alerting on a stuck or flooded system requires custom scraping
of the JSON `/status` endpoint instead of using standard Prometheus alert rules.

## Desired Outcome

Two new Prometheus gauges added to `daemon-control-metrics.ts`:

- **`kota_workflow_active_runs`** (gauge, label `workflow`): current number of actively
  executing runs per workflow name. Derived from `handle.getWorkflowLiveStatus().activeRuns`.
- **`kota_workflow_queued_runs`** (gauge): total count of runs currently waiting in the
  dispatch queue. Derived from the queued run count in live status.

Both gauges are documented in `docs/DAEMON-API.md` alongside the existing metrics table.

## Constraints

- Read-only change to `daemon-control-metrics.ts` — no new state or persistence needed.
- `handle.getWorkflowLiveStatus()` already returns `activeRuns`; derive counts from it.
- Queue depth must come from the same live-status handle, not a separate call.
- Follow the existing `buildPrometheusMetrics` pattern: add HELP/TYPE lines, then values.
- Labels must use the same `sanitizeLabelValue` helper already in the file.

## Done When

- `GET /metrics` includes `kota_workflow_active_runs` with per-workflow labels.
- `GET /metrics` includes `kota_workflow_queued_runs` total gauge.
- Both metrics are documented in `docs/DAEMON-API.md` metrics table.
- A unit test in `daemon-control.test.ts` or a new metrics test confirms non-zero gauge
  values are emitted when active runs or queued runs are present.
