---
id: task-workflow-concurrent-runs
title: Allow different workflows to run concurrently
status: backlog
priority: p2
area: workflow
summary: The runtime serializes all workflow runs globally. Allowing two different workflows (e.g., explorer and improver) to run simultaneously would cut the idle time between cycles and improve overall throughput.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

`WorkflowRuntime` uses a single `activeRunPromise` guard, which means only one workflow can run at a time across the entire system. When the builder finishes and the improver starts, any incoming explorer trigger must wait. This adds latency to each full cycle even when the workflows are logically independent.

## Desired Outcome

- The runtime supports running up to N workflows concurrently (configurable, default 1 for safety).
- Two *different* workflows can overlap; the same workflow name is still serialized (at most one instance per workflow).
- Queued runs for a workflow are held until the previous instance of that workflow completes.
- `kota workflow status` reflects multiple active runs when they exist.
- Abort and pause semantics apply to each active run independently.

## Constraints

- Do not change the default behavior: concurrent limit defaults to 1 so existing deployments are unaffected.
- Same-workflow serialization must be preserved to prevent task double-claim.
- Run persistence and cost tracking must work correctly when multiple runs are in flight.
- Integration tests must cover concurrent execution and correct serialization.

## Done When

- A `maxConcurrentRuns` config option exists on `WorkflowRuntime`.
- Different workflows can execute concurrently up to that limit.
- Same-workflow queue still serializes correctly.
- `kota workflow status` shows all active runs.
- Tests verify concurrent and serialized behavior.
