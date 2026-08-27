---
status: done
---

# Store triggering run ID in workflow run metadata for causal traceability

## Problem

`WorkflowRunMetadata` stores the trigger event and payload but not the run ID of the workflow that caused this run to start. The `workflow.completed` payload already carries `runId`, so the data exists at dispatch time but is discarded. Without it, the explorer→builder→improver chain can only be approximated from timestamps; there is no authoritative link between runs.

This makes it harder for the improver to correlate a failed builder run with the explorer run that produced the task, or to reason about which builder run an improver run was responding to.

## Desired Outcome

- `WorkflowRunMetadata` includes an optional `triggeredByRunId` field.
- When a run is dispatched from a `workflow.completed` (or any bus event whose payload carries a `runId`), the runtime extracts and stores it.
- `kota workflow list` and `kota workflow logs` surface the causal link where available.
- The aggregate history stats command (`kota workflow history`) can optionally group or annotate runs by causal chain.

## Constraints

- Change is additive; existing runs without the field should degrade gracefully.
- Source of `triggeredByRunId` is the triggering event payload — do not compute it from timing heuristics.
- No schema migration needed; the field is optional in stored JSON.

## Done When

- `triggeredByRunId` is populated on runs triggered by another run's completion.
- Run metadata validation accepts the optional field.
- At least `kota workflow list` shows the causal link.
- Tests verify the field is set on trigger-originated dispatches.
