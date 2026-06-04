---
id: task-add-compiled-automation-graph-explain-api
title: Add compiled automation graph explain API
status: backlog
priority: p1
area: modules
summary: Extend the existing workflow graph into an explainable compiled automation view that shows triggers, filters, batches, policies, idempotency, effects, downstream runs, and why a sample event would or would not execute.
depends_on: [task-unify-hooks-and-workflows-under-one-automation-pro, task-add-generic-event-batching-to-workflow-triggers, task-add-module-capability-and-effect-manifest]
created_at: 2026-06-03T15:50:37.825Z
updated_at: 2026-06-03T15:50:37.825Z
---

## Problem

KOTA already has a workflow graph endpoint and workflow dry-run support, but
the graph is mostly structural. It does not explain the fully compiled
automation contract an operator cares about: which event sources feed which
workflows, how filters/batches/policies/idempotency interact, what effects may
happen, what owner decisions are required, what downstream workflows are
triggered, and why a sample event would be ignored, batched, queued, blocked,
or executed.

As hooks/workflows/scopes/channels become more powerful, operators need one
explain API rather than reading workflow code, module config, routing rules,
policies, run logs, and client UI separately.

## Desired Outcome

Extend the workflow-ops graph into a compiled automation graph and explain API.
The API should consume validated workflow definitions, module event schemas,
batch declarations, routing rules, scope policies, module capability/effect
manifests, idempotency declarations, setup/auth status, and owner decision
requirements, then return a single inspectable graph.

The API should answer:

- What listens to this event or batch?
- What filters, scopes, and policy gates apply?
- What workflow/agent/tool/code/approval steps may run?
- What modules and external effects are reachable?
- What setup/auth requirements block execution?
- What downstream events/workflows can be emitted?
- Given this sample event payload, will it run, batch, block, dead-letter, or
  no-op, and why?

## Constraints

- Do not add a separate workflow runtime or graph DSL. Reuse existing workflow
  definitions, validation, graph assembly, dry-run, and trial infrastructure.
- Keep explain output deterministic and machine-readable. Clients can render it
  differently, but the daemon API owns the contract.
- Do not leak secret values or full sensitive payloads through explain output.
- Do not mark ambiguous cases as "safe". If runtime data is missing, return a
  typed unknown/blocking reason.
- Keep graph extraction pure where possible so it remains unit-testable.

## Done When

- A compiled automation graph type exists and extends or replaces the current
  workflow graph response with policies, batches, effects, schemas, blockers,
  and downstream links.
- A daemon API can explain one workflow, one event type, or one sample event
  payload.
- CLI/client fixtures can render the explain result for a channel event and a
  code-hook-style event.
- Tests cover event-to-workflow matching, ignored archived/blocked source,
  batch pending/flush explanation, setup blocker, idempotency duplicate,
  owner-confirmation gate, downstream workflow edge, and redacted projection.

## Source / Intent

Owner request on 2026-06-03 asked for clear definitions, protocols, workflows,
constraints, use-cases, and scenarios that show how KOTA can express expected
behavior. Local investigation found `src/modules/workflow-ops/graph/assemble.ts`
already assembles workflow/event/agent nodes and `src/modules/workflow-ops/execution/dry-run.ts`
already explains step execution shape, so the right improvement is a compiled
explain layer over those surfaces.

Research references:

- Airflow calculates DAG dependencies for graph visualization from serialized
  scheduler metadata: `https://airflow.apache.org/docs/apache-airflow/2.10.3/core-concepts/dags.html`
- Temporal's event history model shows the value of using recorded events to
  explain execution and recovery: `https://docs.temporal.io/workflows`

## Initiative

Operator-legible automation: every hook/workflow/channel scenario should be
explainable before and after it runs.

## Acceptance Evidence

- Unit tests for compiled graph assembly and sample-event explain results.
- Daemon API fixture showing why a Telegram-like event is ignored, batched, or
  queued.
- CLI transcript or rendered fixture showing the same explain result without
  leaking sensitive payload fields.
