# Grafana Setup for KOTA Metrics

KOTA exposes a Prometheus-compatible `/metrics` endpoint. This guide covers connecting it to Grafana.

## Discover the daemon port

The daemon writes its control address to `.kota/daemon-control.json` when it starts:

```json
{
  "port": 4321,
  "token": "<bearer-token>"
}
```

Read this file to get the current port. The port is ephemeral — it changes on each daemon restart.

## Configure Prometheus scraping

Add a job to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: kota
    static_configs:
      - targets: ['127.0.0.1:4321']
    authorization:
      type: Bearer
      credentials: '<token from daemon-control.json>'
```

Replace `4321` and `<token>` with the values from `.kota/daemon-control.json`. Restart Prometheus after editing.

## Available metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `kota_workflow_runs_total` | counter | `workflow`, `status` | Lifetime run counts per workflow and completion status. |
| `kota_workflow_cost_usd_total` | counter | `workflow` | Cumulative agent spend in USD per workflow. |
| `kota_workflow_run_duration_seconds` | histogram | `workflow`, `status` | Duration of completed runs. Buckets: 30 s, 2 m, 5 m, 15 m, 30 m, 60 m. |
| `kota_workflow_active_runs` | gauge | `workflow` | Currently executing runs per workflow. |
| `kota_workflow_queued_runs` | gauge | — | Runs waiting in the dispatch queue. |
| `kota_active_sessions_total` | gauge | — | Active interactive sessions (`kota serve`). |
| `kota_pending_approvals_total` | gauge | — | Pending tool-call approvals awaiting operator decision. |
| `kota_dispatch_paused` | gauge | — | `1` when workflow dispatch is paused, `0` otherwise. |

`status` label values: `success`, `failed`, `interrupted`.

## Import the sample dashboard

A ready-to-import dashboard is provided at `docs/grafana-dashboard.json`. It covers:

- Active and queued workflow runs
- Run success/failure rates per workflow (7-day window)
- Per-workflow cumulative cost
- Active sessions and pending approvals gauges
- Dispatch paused indicator

**Import steps:**

1. Open Grafana → Dashboards → Import.
2. Upload `docs/grafana-dashboard.json` or paste its contents.
3. Select your Prometheus data source when prompted.
4. Click **Import**.

The dashboard uses the `${DS_PROMETHEUS}` variable, so it works with any Prometheus source name.
