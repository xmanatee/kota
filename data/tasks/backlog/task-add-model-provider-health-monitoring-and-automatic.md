---
id: task-add-model-provider-health-monitoring-and-automatic
title: Add model provider health monitoring and automatic failover
status: backlog
priority: p2
area: runtime
summary: The model-clients module creates a single ModelClient per provider with no cross-provider failover. If Anthropic API goes down during unattended autonomous workflows, all agent steps stall. Add health-aware routing that detects provider errors and automatically fails over to an alternative configured provider.
created_at: 2026-04-15T02:51:32.099Z
updated_at: 2026-04-15T02:51:32.099Z
---

## Problem

KOTA resolves a single `ModelClient` per provider at startup via the factory in
`src/modules/model-clients/factory.ts`. The Anthropic client retries within the
same provider (`maxRetries: 5`), but there is no cross-provider failover. If the
primary provider (typically Anthropic) experiences an outage, rate-limits, or
returns persistent 5xx errors, all agent steps in autonomous workflows stall
until the provider recovers.

For unattended daemon operation this is a real availability gap — the operator
may not notice for hours.

## Desired Outcome

A health-aware model routing layer that:

- Tracks per-provider error rates using a sliding window (e.g., last N requests
  or last M seconds).
- Detects unhealthy providers when the error rate exceeds a configurable
  threshold.
- Automatically routes requests to a configured fallback provider when the
  primary is unhealthy.
- Recovers back to the primary provider after a configurable cool-down period
  with a successful probe.
- Emits a bus event (`model.provider.failover`) when failover occurs so
  notification channels can alert the operator.
- Exposes provider health state in `kota doctor` and `GET /status`.

## Constraints

- The failover config should be optional — operators who only have one provider
  configured should see no behavior change.
- Failover should be transparent to the agent session: the `ModelClient`
  interface stays the same.
- Keep this in the model-clients module, not in core. The core `ModelClient`
  interface does not change.
- Do not retry across providers on every transient error — only fail over when a
  provider is classified as unhealthy based on sustained error patterns.

## Done When

- A configured fallback provider receives requests when the primary is detected
  as unhealthy.
- Recovery back to primary is automatic after the cool-down.
- `model.provider.failover` bus event fires on transition.
- `kota doctor` shows provider health state.
- Tests cover: healthy path (no failover), failover trigger, recovery, and
  single-provider config (no-op).
