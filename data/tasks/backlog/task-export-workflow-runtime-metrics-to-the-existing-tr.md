---
id: task-export-workflow-runtime-metrics-to-the-existing-tr
title: Export workflow runtime metrics to the existing tracing backend
status: backlog
priority: p2
area: observability
summary: Emit per-workflow/per-step metrics (duration, cost, repair-loop hits, failure class) alongside the existing OTLP traces so operator dashboards can render KOTA health without parsing run artifacts
created_at: 2026-04-17T13:14:03.731Z
updated_at: 2026-04-17T13:14:03.731Z
---

## Problem

KOTA already emits OTLP traces through the `tracing` module, and the workflow runtime records rich per-step data (duration, cost, repair-loop tallies, failure classification, tool-use summaries) in run artifacts. But none of that is exposed as metrics. Operators who want to see workflow health over time today have to parse `.kota/runs/` by hand or scroll through the web UI run list. There is no Grafana-shaped view of "how often does builder fail this week," "what is the median repair-loop cost per workflow," or "which workflow is driving the rate-limit classification spike." Traces alone are too granular for health dashboards.

## Desired Outcome

- The `tracing` module (or a focused sibling) emits OpenTelemetry metrics for the signals the runtime already records: workflow run counts by status, run duration histogram, per-step cost histogram, repair-loop hits by check id, failure classification counts.
- Metrics are driven by the same bus events the trace layer already subscribes to — no second event protocol, no duplicate event plumbing.
- The exporter is opt-in via the same config shape as tracing and uses the same endpoint conventions, so operators configure one backend, not two.
- An operator can point Grafana/Prometheus at the OTLP endpoint and render workflow health without reading files on disk.

## Constraints

- No test-only flags on workflow or step types. Metric emission must flow through the normal bus events and module subscription model.
- Autonomy agents must not see metric dashboards or per-workflow cost aggregates — this is an operator surface only. Keep the exporter off the agent prompt surface entirely.
- Follow KOTA's boundary rule: the metrics exporter belongs in `src/modules/tracing/` (or a new co-located sibling module), not in `src/core/`.
- Metric names and labels should match OpenTelemetry semantic conventions where they exist (workflow name → attribute, not label explosion).

## Done When

- Running KOTA with `tracing.endpoint` configured produces both traces and metrics against the same OTLP target.
- At least duration, cost, and failure-class metrics are emitted for every completed workflow run.
- A test verifies the exporter wiring against the module harness (event in → metric recorded).
- Docs under `docs/` (or the tracing module's local `AGENTS.md`) describe the emitted metrics without listing every metric name — conventions and attribute shape are enough.

