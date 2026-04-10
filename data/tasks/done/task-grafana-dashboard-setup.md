---
id: task-grafana-dashboard-setup
title: Grafana dashboard and setup guide for KOTA metrics
status: done
priority: p3
area: observability
summary: KOTA exposes a Prometheus endpoint but operators have no guidance on connecting it to Grafana; a docs guide and a sample dashboard definition would close that gap.
created_at: 2026-04-02T11:35:00Z
updated_at: 2026-04-07T12:00:00Z
---

## Problem

KOTA's `/metrics` endpoint exposes Prometheus-format data covering workflow run counts, cost, duration histograms, active sessions, pending approvals, and queue depth. Operators who want to visualize this in Grafana have to figure out scrape config and dashboard structure themselves. There is no `docs/GRAFANA.md`, no example dashboard JSON, and no mention of the endpoint in CONFIG.md.

## Desired Outcome

A `docs/GRAFANA.md` guide explains:
- How to configure a Prometheus scrape job pointing at `http://127.0.0.1:<port>/metrics`.
- How to discover the port from `.kota/daemon-control.json` and add it to `prometheus.yml`.
- A reference to all available metrics with a brief description of each.

A sample Grafana dashboard JSON is provided (e.g., under `docs/grafana-dashboard.json` or embedded in the doc) covering: active workflow runs, run success/failure rates, per-workflow cost totals, and pending approvals gauge. The dashboard should be importable via Grafana's dashboard import UI without modification.

## Constraints

- The guide must use only the existing `/metrics` endpoint; no new metrics or endpoint changes required.
- Dashboard JSON must target Grafana 10+ and use standard Prometheus data source variable `${DS_PROMETHEUS}`.
- Keep the guide concise; this is operator setup documentation, not a tutorial.

## Done When

- `docs/GRAFANA.md` exists and covers scrape config discovery, all exposed metrics, and import instructions.
- A sample dashboard JSON file is present in the repo and importable into a local Grafana instance.
- `docs/CONFIG.md` cross-references the metrics endpoint.
