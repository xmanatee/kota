---
id: task-workflow-cost-forecast-endpoint
title: Add workflow cost forecast endpoint using historical run baselines
status: backlog
priority: p2
area: core
summary: The cost anomaly detector maintains rolling per-workflow cost baselines. Expose a forecast endpoint so operators and the dispatch layer can estimate expected cost before running a workflow.
created_at: 2026-04-12T09:30:00Z
updated_at: 2026-04-12T09:30:00Z
---

## Problem

The cost anomaly detector (`src/core/workflow/cost-anomaly-detector.ts`)
computes rolling average cost baselines per workflow from historical runs. These
baselines are used post-run to flag anomalies, but the data is not accessible
before a run starts.

Operators have no way to estimate how much a workflow will cost before
dispatching it. The daily budget guard tracks aggregate spend but does not
forecast per-workflow cost. When operators manually trigger an expensive
workflow, or when the dispatcher queues multiple workflows, there is no
signal about expected cost impact until the runs complete.

## Desired Outcome

A daemon control API endpoint (e.g. `GET /workflows/:name/forecast`) returns
the expected cost for a single run of the named workflow, drawn from the
existing cost baseline data. The response includes the baseline average, run
count used, and a confidence indicator (high if many recent runs, low if few
or stale baseline).

The CLI (`kota workflow forecast <name>` or similar) calls the endpoint and
prints a human-readable summary.

## Constraints

- Read from the existing `cost-baseline.json` files — do not add a new
  persistence surface.
- The endpoint is read-only and does not block dispatch.
- Return a clear "no data" response when the baseline file does not exist or
  has too few runs.
- Do not add forecast logic to the dispatch hot path. The endpoint is
  informational only.

## Done When

- A control API endpoint returns forecast data for a named workflow.
- A CLI command prints the forecast in human-readable format.
- The response includes baseline average, sample size, and staleness indicator.
- Tests cover: workflow with healthy baseline, workflow with no data, workflow
  with stale baseline.
