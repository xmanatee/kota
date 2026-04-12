---
id: task-module-runtime-health-protocol
title: Add optional runtime health check protocol to modules for daemon and doctor probing
status: backlog
priority: p2
area: core
summary: Modules can load and unload but cannot report runtime health. The daemon and doctor have no way to detect degraded modules (expired tokens, lost connections, crashed subprocesses) after initial load succeeds.
created_at: 2026-04-12T05:36:07Z
updated_at: 2026-04-12T05:36:07Z
---

## Problem

The module protocol supports `onLoad` and `onUnload` lifecycle hooks, but
there is no mechanism for a module to report its runtime health after loading.

A module may load successfully but later enter a degraded state:
- An OAuth token expires (google-workspace, linear, jira).
- A foreign module subprocess crashes and exhausts restart retries.
- A database connection drops (sqlite-memory).
- A webhook endpoint becomes unreachable (slack, telegram).

The doctor module checks static configuration and daemon connectivity but
cannot probe individual module health. The `/health` daemon endpoint reports
component-level liveness but not module-level readiness.

## Desired Outcome

Modules can optionally declare a `healthCheck` function in their module
definition. The function returns a typed result: `{ status: "healthy" | "degraded" | "unhealthy", message?: string }`.

The daemon periodically probes modules that declare health checks and includes
results in the `/health` endpoint response. `kota doctor` surfaces module
health when the daemon is running.

## Constraints

- The health check is optional. Modules without one are assumed healthy.
- Health check functions must be fast (< 1s). They probe cached state or do
  a lightweight ping, not a full integration test.
- Keep the protocol in `src/core/modules/` (module protocol extension).
- The daemon owns the polling interval and aggregation. Modules just implement
  the function.
- Do not break existing module definitions. The field is optional on the
  module type.

## Done When

- The module protocol type accepts an optional `healthCheck` function.
- At least one module implements a health check (e.g. sqlite-memory or a
  foreign module wrapper).
- The daemon probes declared health checks and includes results in `/health`.
- `kota doctor` reports module health status when the daemon is running.
- Tests cover the protocol, a sample health check, and aggregation.
