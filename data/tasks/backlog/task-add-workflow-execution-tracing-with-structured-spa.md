---
id: task-add-workflow-execution-tracing-with-structured-spa
title: Add workflow execution tracing with structured spans
status: backlog
priority: p2
area: runtime
summary: Workflow runs produce cost metrics and run artifacts but lack structured execution traces. When debugging multi-step workflow failures, operators must manually correlate log entries and step outputs. Add OpenTelemetry-compatible trace IDs and spans so each workflow run produces a traceable execution tree visible in Grafana Tempo or Jaeger.
created_at: 2026-04-15T02:52:26.448Z
updated_at: 2026-04-15T02:52:26.448Z
---

## Problem

KOTA's workflow runtime produces Prometheus metrics (`/metrics`), per-run cost
tracking, and file-based run artifacts. But there is no structured execution
tracing: when a multi-step autonomous workflow fails or behaves unexpectedly, the
operator must manually read step outputs in `.kota/runs/`, correlate timestamps,
and reconstruct the execution path.

The daemon already has a Grafana dashboard for metrics. Adding structured traces
would complete the observability picture and make debugging autonomous workflows
practical at scale.

## Desired Outcome

OpenTelemetry-compatible tracing integrated into the workflow runtime:

- Each workflow run creates a root span with the run ID, workflow name, and
  trigger event.
- Each step within the run creates a child span with step ID, step type, duration,
  and status (success/failure/skipped).
- Agent steps include token usage and model name as span attributes.
- Tool calls within agent steps create nested spans.
- Traces are exported via OTLP (gRPC or HTTP) to any compatible backend (Grafana
  Tempo, Jaeger, Honeycomb).
- A `tracing` config block controls the export endpoint and sampling rate.

## Constraints

- Use `@opentelemetry/api` for instrumentation and `@opentelemetry/sdk-trace-node`
  for export. These are the standard Node.js OpenTelemetry packages.
- Tracing should be opt-in. When no export endpoint is configured, the overhead
  is zero (no-op tracer).
- Implement as a module that hooks into the workflow runtime via bus events or
  the existing step lifecycle, not as inline changes to `run-executor.ts`.
- Span context should propagate through the run executor so child spans are
  correctly parented.
- Do not add tracing to interactive CLI sessions — only daemon workflow
  execution.

## Done When

- A workflow run with 3+ steps produces a correctly nested trace visible in
  Jaeger or Grafana Tempo.
- Span attributes include run ID, workflow name, step ID, step type, duration,
  and status.
- Agent step spans include model and token counts.
- Config `tracing.endpoint` controls where traces are exported.
- No observable overhead when tracing is not configured.
- Tests cover span creation, parent-child nesting, and no-op behavior when
  disabled.
