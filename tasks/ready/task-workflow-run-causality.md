---
id: task-workflow-run-causality
title: Track and expose run causality so operators can trace autonomous trigger chains
status: ready
priority: p3
area: observability
summary: When the improver runs because the builder just completed, or the explorer is triggered by an idle event after a builder cycle, there is no way to trace the chain. Recording which event and which upstream run caused each run would let operators understand the autonomous loop at a glance.
created_at: 2026-04-01T07:22:00Z
updated_at: 2026-04-01T07:36:00Z
---

## Problem

The autonomous loop creates chains: idle → explorer → (workflow.completed) → builder →
(workflow.completed) → improver. Each run record today captures its own trigger payload but
not the upstream run that emitted the triggering event. An operator looking at a list of runs
cannot tell "this improver run was caused by this specific builder run" without cross-referencing
timestamps and event types manually.

As the system matures and runs accumulate (1000+), tracing a failure's origin or understanding
why the improver fired unexpectedly becomes increasingly manual.

## Desired Outcome

Run records include a `causedBy` field populated when a run is spawned from a
`workflow.completed` event. `causedBy` contains the upstream run ID and workflow name.

The web UI run detail panel shows this lineage — "triggered by: builder / run-id-abc" with a
link to that run's detail — and the run history list optionally filters to show the downstream
runs of a selected run ("show runs triggered by this run").

`GET /workflow/runs/:id` includes `causedBy` in the response.

## Constraints

- Only `workflow.completed` event triggers produce a `causedBy` link; cron, idle, manual, and
  file-watch triggers have no upstream run to reference.
- `causedBy` is stored in the run record on disk alongside existing metadata.
- Do not change the event payload shape — derive the upstream run ID from the event envelope
  that the trigger already receives.
- The web UI filter ("show triggered runs") is a stretch goal; the `causedBy` field in run
  records and API is the core requirement.
- No schema migration needed for existing run records; old records simply have no `causedBy`.

## Done When

- `causedBy: { runId, workflow }` is populated in run records triggered by `workflow.completed`.
- `GET /workflow/runs/:id` includes `causedBy` when present.
- Web UI run detail shows a "triggered by" link when `causedBy` is present.
- A unit test verifies that `causedBy` is set correctly when the trigger event carries a run ID.
