---
id: task-emit-session-autonomy-mode-as-an-otlp-attribute-an
title: Emit session autonomy mode as an OTLP attribute and metric
status: done
priority: p2
area: observability
summary: Autonomy mode is now a required session field but is invisible to OTLP telemetry; annotate traces/metrics with autonomy_mode so operator dashboards can slice workflow and tool-runner health by supervision posture
created_at: 2026-04-18T06:12:33.728Z
updated_at: 2026-04-18T06:58:31.885Z
---

## Problem

Session autonomy mode (`passive`, `supervised`, `autonomous`) is now a required
declaration at every session boundary — CLI, channels, server, and workflow
agent steps — and it controls a distinct gating axis on the tool runner. The
OTLP tracing and metrics plumbing in `src/modules/tracing/` already emits
per-workflow and per-step signals, but none of it carries the autonomy axis.
Operators cannot answer questions like "what share of tool calls ran under
supervised mode this week?", "did supervised sessions spike repair-loop cost
versus autonomous runs?", or "how often does a session escalate mid-run from
supervised to autonomous?". The new mid-run integration test
(`src/autonomy-mid-run.integration.test.ts`) already exercises mode changes at
runtime, so the signal exists internally — it just doesn't reach the OTLP
surface.

## Desired Outcome

- Every OTLP span produced by the workflow runtime and tool-runner carries an
  `autonomy_mode` attribute reflecting the session's effective mode when the
  span started.
- The tracing module emits a counter for autonomy-mode transitions (from →
  to) so operators can see how often a session's posture changes mid-run.
- Existing workflow metrics (run duration, step cost, repair-loop hits,
  failure-class counts) gain an `autonomy_mode` attribute so operators can
  slice dashboards by supervision posture without a second export.
- Operator dashboards can answer "which autonomy mode is dominating this
  workflow's failures" without parsing run artifacts.

## Constraints

- Emit only from existing bus events and session-state reads. Do not add a
  second event protocol or a parallel metric exporter.
- Keep emission inside `src/modules/tracing/`. Do not leak OTLP concerns back
  into `src/core/`.
- Autonomy agents must not observe these metrics or transition histories — this
  is an operator surface only, consistent with the existing cost/budget
  boundary.
- Attribute names follow OpenTelemetry semantic-convention shape where one
  exists (prefer a small attribute set over label explosion).
- No test-only hooks on session or runtime types. Drive the tests through the
  module harness with real bus events.

## Done When

- Workflow and tool-runner spans include an `autonomy_mode` attribute.
- A tested metric records autonomy-mode transitions per session.
- Existing workflow metrics carry an `autonomy_mode` attribute alongside
  workflow name and status.
- A test (against the module harness) asserts that transitioning a session's
  mode mid-run produces the expected transition metric and that subsequent
  spans carry the new mode.
- Tracing module docs describe the new attribute and the transition counter
  at the conventions level, without listing every metric name.
