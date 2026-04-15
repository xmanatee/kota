# Tracing Module

This module provides OpenTelemetry workflow execution tracing.

- Subscribes to workflow bus events and creates structured spans.
- Opt-in via the `tracing.endpoint` config field.
- When no endpoint is configured, no bus subscriptions are registered (zero overhead).
- Model info for agent steps is resolved from contributed workflow definitions at load time.
- Agent turn counts are read from step result files in the run directory.
