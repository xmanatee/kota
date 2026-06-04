---
id: task-add-event-automation-simulation-harness
title: Add event automation simulation harness
status: backlog
priority: p2
area: modules
summary: Add a simulation harness that feeds synthetic or journaled events through routing, batching, policy, idempotency, and workflow explain/dry-run paths to preview automations without live side effects.
depends_on: [task-add-durable-event-envelope-and-journal, task-add-generic-event-batching-to-workflow-triggers, task-add-compiled-automation-graph-explain-api, task-add-module-capability-and-effect-manifest]
created_at: 2026-06-03T15:51:10.814Z
updated_at: 2026-06-03T15:51:10.814Z
---

## Problem

KOTA already has workflow dry-run, replay, trial mode, tracing, and a workflow
graph. Those tools are useful, but they do not yet provide an event-level
simulation harness for the scenarios the owner cares about: "a Telegram message
arrives from an archived group", "a high-volume group is batched", "a cheap
classifier screens messages", "a smarter model checks before owner prompt",
"owner confirms", and "provider-specific booking/reaction would run."

Operators need to test routing, batching, scope policy, setup blockers,
idempotency, owner-confirmation gates, and side-effect blocking without
touching live Telegram/Gmail/Slack/web providers.

## Desired Outcome

Add an event automation simulation harness that reuses existing workflow
dry-run/trial/replay/explain features. The harness should accept synthetic
event envelopes or journaled event ids, feed them through the same routing,
filtering, batching, policy, idempotency, owner-decision, and explain paths,
and return a deterministic preview of what would happen.

It should support:

- Synthetic single event and batch event inputs.
- Journal replay by event id/range.
- "Would ignore", "would batch", "would queue", "would block", "would ask
  owner", "would DLQ", and "would perform effect" outcomes.
- Side-effect previews using module capability/effect manifests.
- Fixtures for Telegram, Slack, Gmail, file-watch, and task-progress events.
- Client-renderable results through the shared UI protocol when available.

## Constraints

- Do not duplicate existing workflow dry-run, trial, replay, or graph code.
  Compose them behind an event-level harness.
- Do not execute live provider writes, send messages, mutate external sites, or
  store secrets during simulation.
- Keep simulation output explicit about unknowns and missing setup.
- Do not let simulation-only flags leak into production runtime paths.
- Use durable event envelopes and schemas so simulated payloads exercise the
  same validators as real inputs.

## Done When

- A simulation API/CLI command accepts a typed event envelope or journal cursor
  and returns a deterministic automation preview.
- The harness composes workflow explain, dry-run/trial mode, batching policy,
  scope policy, idempotency checks, and module effect manifests.
- Tests cover ignored archived/blocked source, batch pending, batch flush,
  idempotency duplicate, missing setup blocker, owner-confirmation gate,
  side-effect preview, and DLQ outcome.
- Fixtures demonstrate Telegram sports-community intake and weekly
  progress-review trigger simulation without live providers.

## Source / Intent

Owner scenarios on 2026-06-03 require proving how KOTA would behave for channel
messages, batches, staged model checks, owner confirmations, and provider
actions. Local investigation found existing workflow dry-run/trial/replay:

- `src/modules/workflow-ops/execution/dry-run.ts`
- `src/modules/workflow-ops/execution/trial.ts`
- `src/modules/workflow-ops/routes/workflow-routes.ts`
- `src/modules/workflow-ops/graph/assemble.ts`

The improvement is an event-level harness over those mechanisms, not a second
workflow simulator.

Research reference: Temporal uses recorded event history to replay workflow
state while avoiding redoing external work:
`https://docs.temporal.io/workflows`

## Initiative

Safe automation rehearsal: complex event-driven automations can be tested and
explained before KOTA touches live channels or external services.

## Acceptance Evidence

- CLI transcript under `.kota/runs/<run-id>/transcript.txt` simulating a
  Telegram sports message from ignored, batched, and accepted sources.
- Unit/integration test output for simulation outcomes and side-effect
  blocking.
- Committed fixture showing a journaled event replayed into simulation with no
  live provider calls.
