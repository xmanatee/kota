# Tracing Module

This module provides OpenTelemetry workflow execution tracing and metrics.

- Subscribes to workflow bus events and emits both structured spans and
  operator-facing metrics.
- Opt-in via the `tracing.endpoint` config field. Metrics use the same endpoint
  unless `tracing.metricsEndpoint` is set.
- When no endpoint is configured, no bus subscriptions are registered (zero
  overhead).
- Model info for agent steps is resolved from contributed workflow definitions
  at load time.
- Agent turn counts, cost, tokens, and repair-loop failures are read from step
  result files in the run directory; add new enrichment to the same reader
  rather than plumbing a second event channel.
- Metric names are `kota.workflow.*`. Attribute shape: workflow name, step id,
  step type, and status travel as attributes, not label explosions. Failure
  classification mirrors the `WorkflowAgentBackoffKind` union so dashboards
  count the same classes the runtime already uses for agent-dispatch backoff.
- Workflow and step spans carry an `autonomy_mode` attribute when a posture
  applies (workflow default for run-level spans and non-agent steps; the
  step's declared mode for agent steps). The same attribute travels on run,
  step, cost, token, repair-loop, and failure metrics so dashboards can slice
  by supervision posture without a second attribute catalog.
- A session-autonomy transition counter is emitted when an operator changes a
  session's mode mid-flight, labelled by `autonomy.from` and `autonomy.to`.
  The counter is driven by the typed `session.autonomy.changed` bus event so
  autonomous agents do not observe it themselves.
