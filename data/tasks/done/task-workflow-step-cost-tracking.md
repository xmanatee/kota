---
id: task-workflow-step-cost-tracking
title: Track and expose per-step cost in workflow run metadata and step events
status: done
priority: p2
area: runtime
summary: Workflow runs record total cost but not per-step cost. Adding costUsd to WorkflowStepResult and the workflow.step.completed bus event lets operators and modules see exactly which steps are expensive, enabling targeted optimization and finer-grained anomaly detection.
created_at: 2026-04-02T08:57:28Z
updated_at: 2026-04-02T08:57:28Z
---

## Problem

`WorkflowRunMetadata.totalCostUsd` accumulates cost across all steps but `WorkflowStepResult` has no `costUsd` field. Similarly, the `workflow.step.completed` bus event carries no cost information.

Operators and modules that want to understand which step in a multi-step workflow is the expensive one have no data path to that answer without reading raw run artifacts and correlating token counts manually. The cost anomaly detector operates at run granularity; it cannot flag a single expensive step within an otherwise normal run.

## Desired Outcome

- `WorkflowStepResult` gains an optional `costUsd?: number` field populated for agent steps.
- `run-executor-step.ts` records step cost from the session's `CostTracker` after each agent step completes.
- The `workflow.step.completed` bus event payload includes `costUsd?: number`.
- The daemon API run detail (`GET /api/workflow/runs/:id`) includes `costUsd` per step in the `steps` array.
- The web UI run detail step list shows a compact cost annotation next to agent step rows.

Non-agent steps (code, tool, branch, foreach, approval) have `costUsd: 0` or omit the field.

## Constraints

- No changes to the `CostTracker` API; read from the session cost tracker after step completion.
- `costUsd` is optional in `WorkflowStepResult` to keep backward compatibility with existing run artifacts that lack the field.
- Do not add cost tracking to code, tool, or emit steps — those do not run agent sessions.
- The web UI annotation should be compact (e.g., `$0.04`) and only shown when cost > 0.

## Done When

- `WorkflowStepResult.costUsd` is defined and populated for agent steps.
- `workflow.step.completed` bus event includes `costUsd` for agent steps.
- Daemon API run detail includes per-step cost.
- Web UI step list shows cost next to agent step rows.
- Unit test verifies cost is captured correctly per step.
