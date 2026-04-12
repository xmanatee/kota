---
id: task-cost-anomaly-bus-events
title: Emit bus events from cost anomaly detector so notification channels can alert operators
status: done
priority: p1
area: core
summary: The cost anomaly detector returns results but does not emit bus events. Notification channels (Telegram, Slack, email) cannot react to cost spikes because no event reaches the bus.
created_at: 2026-04-12T05:36:07Z
updated_at: 2026-04-12T06:34:55.276Z
---

## Problem

`src/core/workflow/cost-anomaly-detector.ts` computes whether a completed
workflow run's cost is anomalously high compared to its rolling baseline. The
function returns a `CostAnomalyResult` object but does not emit a bus event.

The attention-digest workflow and notification channel modules subscribe to bus
events. Without an emitted event, cost anomalies are invisible to the
notification infrastructure. Operators only discover cost spikes by manually
checking the dashboard or `/metrics` endpoint.

## Desired Outcome

When the cost anomaly detector flags a run, a typed bus event
(e.g. `workflow.cost.anomaly`) is emitted with the anomaly details: workflow
name, run id, actual cost, baseline average, and threshold exceeded.

Notification channel modules and the attention-digest workflow can then
subscribe to this event and alert the operator without any additional wiring.

## Constraints

- The event must be typed in the event catalog (`src/core/events/`).
- Emission should happen at the call site that already invokes the detector
  (likely in the workflow run completion path), not inside the detector itself.
- Do not add notification-specific logic to core. The event is generic; modules
  decide how to present it.
- Keep the detector function pure — it returns results, the caller emits.

## Done When

- A typed `workflow.cost.anomaly` event (or equivalent) exists in the event catalog.
- The workflow run completion path emits this event when a cost anomaly is detected.
- The attention-digest workflow or a test demonstrates subscription to the event.
- Existing cost anomaly detector tests still pass.
