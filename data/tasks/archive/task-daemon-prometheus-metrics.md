---
status: done
---

# Expose daemon metrics in Prometheus format

## Problem

KOTA's daemon tracks workflow run counts, cumulative costs, active sessions, and
approval queue depth in memory, but exposes this data only through JSON endpoints
that require custom parsing. Teams running Prometheus, Grafana, or other standard
monitoring tools have no way to scrape KOTA metrics without a custom exporter.

`GET /status` gives a snapshot but returns a deeply nested JSON object — it's not
suitable as a Prometheus scrape target. Operators must write adapter code or forgo
metric dashboards entirely.

## Desired Outcome

A `GET /metrics` endpoint on the daemon control API that returns metrics in
Prometheus text exposition format:

- `kota_workflow_runs_total{workflow="<name>",status="<status>"}` — lifetime run
  counts by workflow and terminal status (`success`, `failed`, `interrupted`).
- `kota_workflow_cost_usd_total{workflow="<name>"}` — cumulative agent spend per workflow.
- `kota_active_sessions_total` — current count of active interactive sessions.
- `kota_pending_approvals_total` — current count of pending approval requests.
- `kota_dispatch_paused` — 1 if workflow dispatch is paused, 0 otherwise.

No external Prometheus client library is required — the format is simple enough to
generate with string templates. The endpoint should be documented in `docs/DAEMON-API.md`.

## Constraints

- Read-only; no mutation of state.
- Endpoint should be under the `read` capability scope.
- No new npm dependencies; use the existing HTTP server in `daemon-control.ts`.
- Metric names must follow Prometheus naming conventions (snake_case, `_total` suffix for
  counters). Labels must not contain carriage returns or quotes.
- The endpoint does not need to be a full OpenMetrics/scrape-standard implementation;
  the basic Prometheus text format is sufficient.

## Done When

- `GET /metrics` on the daemon control API returns valid Prometheus text format.
- Includes at minimum the five metric families above.
- `docs/DAEMON-API.md` documents the new endpoint.
- At least one test verifies the response format and metric presence.
